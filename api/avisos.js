// WEBHOOKS de aviso do Banco de Horas. O agendador da Vercel (cron) chama sozinho; também dá pra chamar à mão.
//   tipo=agenda    todo dia 1º: avisa TODOS os funcionários inscritos pra preencherem a agenda do mês
//   tipo=lembrete  todo dia: avisa quem está ESCALADO em evento do dia seguinte (evento, data, hora se houver, e a função)
// Chamada:  GET/POST /api/avisos?tipo=agenda|lembrete   [&data=AAAA-MM-DD  (simula "hoje")]  [&dry=1  (só mostra, não envia nada)]
// Autorização: o cron manda "Authorization: Bearer <CRON_SECRET>"; à mão use o header x-webhook-secret: <WEBHOOK_SECRET>.
// Este arquivo NUNCA grava na chave dos dados do app.
const crypto = require('crypto');
const { KV_URL, KV_TOKEN, KEYS, kv, lerDados, parear } = require('./_util');

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function igual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest(), hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function autorizado(req) {
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, ''), seg = req.headers['x-webhook-secret'] || '';
  const cron = process.env.CRON_SECRET || '', web = process.env.WEBHOOK_SECRET || '';
  return (cron && bearer && igual(bearer, cron)) || (web && seg && igual(seg, web));
}
// "hoje" no horário de Brasília (UTC-3, sem horário de verão)
const brt = (d = new Date()) => new Date(d.getTime() - 3 * 3600e3);
const iso = x => x.toISOString().slice(0, 10);
const mais1 = dataIso => iso(new Date(new Date(dataIso + 'T00:00:00Z').getTime() + 864e5));
const dm = dataIso => dataIso.slice(8, 10) + '/' + dataIso.slice(5, 7);
const diaSemana = dataIso => DIAS[new Date(dataIso + 'T00:00:00Z').getUTCDay()];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'use_GET_ou_POST' }); return; }
  if (!autorizado(req)) { res.status(401).json({ error: 'nao_autorizado' }); return; }
  if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'banco_nao_configurado' }); return; }
  const q = new URL(req.url, 'http://x').searchParams;
  const tipo = q.get('tipo'), dry = q.get('dry') === '1';
  if (tipo !== 'agenda' && tipo !== 'lembrete') { res.status(400).json({ error: 'tipo_deve_ser_agenda_ou_lembrete' }); return; }
  const dataParam = q.get('data');
  if (dataParam && !/^\d{4}-\d{2}-\d{2}$/.test(dataParam)) { res.status(400).json({ error: 'data_invalida' }); return; }
  const hoje = dataParam || iso(brt());

  try {
    const d = await lerDados();
    const funcionarios = d.funcionarios || [], porId = Object.fromEntries(funcionarios.map(f => [f.id, f]));
    const inscritos = parear((await kv(['HGETALL', KEYS.push])).result).map(([, v]) => { try { return JSON.parse(v); } catch (e) { return null; } }).filter(s => s && porId[s.funcId]);

    // ---- monta as mensagens: { funcId, title, body, url, tag, chave }
    const msgs = [];
    let info = {};
    if (tipo === 'agenda') {
      const ym = hoje.slice(0, 7), mes = MESES[parseInt(hoje.slice(5, 7), 10) - 1];
      const existe = (d.meses || []).some(m => (m.dias || []).some(x => (x.data || '').startsWith(ym)));
      info = { mes: ym, mesCriadoNoApp: existe };
      if (!existe) { res.status(200).json({ ok: true, tipo, hoje, enviados: 0, aviso: 'o mês ' + ym + ' ainda não foi criado no app, então não mandei o aviso de agenda', ...info }); return; }
      for (const f of funcionarios) msgs.push({ funcId: f.id, title: 'Agenda de ' + mes + ' 📅', body: 'Chegou a hora de preencher a sua agenda de ' + mes + ': marque os dias em que você pode e em que não pode.', url: '/#agenda', tag: 'agenda-' + ym, chave: 'agenda:' + ym + ':' + f.id });
    } else {
      const amanha = mais1(hoje);
      info = { amanha };
      for (const m of d.meses || []) for (const dia of m.dias || []) {
        if (dia.data !== amanha || !(dia.evento || '').trim()) continue;
        for (const e of dia.escala || []) {
          if (!porId[e.funcId]) continue;
          const funcao = (d.funcoes || []).find(x => x.id === e.funcaoId), hora = /^([01]\d|2[0-3]):[0-5]\d$/.test(dia.hora || '') ? dia.hora : '';
          msgs.push({ funcId: e.funcId, title: 'Amanhã você tem evento 🎛️', body: dia.evento.trim() + ' · ' + diaSemana(amanha) + ', ' + dm(amanha) + (hora ? ' às ' + hora : '') + (funcao ? ' · Função: ' + funcao.nome : ''),
                       url: '/#agenda', tag: 'evento-' + dia.id, chave: 'lembrete:' + dia.id + ':' + e.funcId });
        }
      }
    }
    const comAparelho = new Set(inscritos.map(s => s.funcId));
    const plano = msgs.map(m => ({ para: (porId[m.funcId] || {}).nome || m.funcId, aparelhos: inscritos.filter(s => s.funcId === m.funcId).length, titulo: m.title, texto: m.body }));
    if (dry) { res.status(200).json({ ok: true, dry: true, tipo, hoje, ...info, mensagens: plano, semAparelho: msgs.filter(m => !comAparelho.has(m.funcId)).map(m => (porId[m.funcId] || {}).nome) }); return; }

    // ---- envia
    const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) { res.status(200).json({ ok: true, enviados: 0, aviso: 'chaves_de_notificacao_nao_configuradas' }); return; }
    const webpush = require('web-push');
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contato@pibn.org.br', pub, priv);
    let enviados = 0, removidos = 0, falhas = 0, repetidos = 0, semAparelho = [];
    for (const m of msgs) {
      const aparelhos = inscritos.filter(s => s.funcId === m.funcId);
      if (!aparelhos.length) { semAparelho.push((porId[m.funcId] || {}).nome || m.funcId); continue; }
      if ((await kv(['GET', KEYS.dedupe + m.chave])).result) { repetidos++; continue; }          // já mandei: não manda duas vezes a mesma coisa
      const payload = JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag });
      let deu = 0;
      await Promise.all(aparelhos.map(async s => {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 86400 }); enviados++; deu++; }
        catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) { removidos++; await kv(['HDEL', KEYS.push, s.endpoint]).catch(() => {}); } else falhas++; }
      }));
      if (deu) await kv(['SET', KEYS.dedupe + m.chave, '1', 'EX', String(tipo === 'agenda' ? 40 * 86400 : 2 * 86400)]);   // só marca como enviado se pelo menos um aparelho recebeu
    }
    await kv(['LPUSH', KEYS.log, JSON.stringify({ quando: new Date().toISOString(), tipo, hoje, mensagens: msgs.length, enviados, repetidos, removidos, falhas })]);
    await kv(['LTRIM', KEYS.log, '0', '99']);
    res.status(200).json({ ok: true, tipo, hoje, ...info, mensagens: msgs.length, enviados, repetidos, removidos, falhas, semAparelho });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
