// Sincronização automática (agendada pelo Cron do Vercel): baixa a planilha do Google,
// calcula as horas pela entrada/saída e atualiza o banco, preservando escala/funções/config.
const XLSX = require('xlsx');

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DATA_KEY = 'banco-horas:data';

async function kv(command) {
  const r = await fetch(KV_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  if (!r.ok) throw new Error('KV ' + r.status + ': ' + (await r.text()));
  return r.json();
}
async function getData() { const out = await kv(['GET', DATA_KEY]); return out && out.result ? JSON.parse(out.result) : { funcionarios: [], meses: [], disponibilidade: {}, funcoes: [], config: {} }; }
async function setData(d) { await kv(['SET', DATA_KEY, JSON.stringify(d)]); }

function cellV(ws, addr) { const c = ws[addr]; return c ? c.v : undefined; }
function serialISO(serial) { const ms = Math.round((serial - 25569) * 86400 * 1000); return new Date(ms).toISOString().slice(0, 10); }
function fracHM(frac) { if (frac == null || frac === '') return ''; const t = (+frac) * 24; let h = Math.floor(t); let m = Math.round((t - h) * 60); if (m === 60) { h++; m = 0; } return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }
function diaSemanaPT(iso) { const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']; return dias[new Date(iso + 'T00:00:00Z').getUTCDay()]; }

function parsePlanilha(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const colH = ['D', 'E', 'F', 'G'], colE = ['I', 'K', 'M', 'O'], colS = ['J', 'L', 'N', 'P'];
  let funcs = null; const meses = [];
  wb.SheetNames.forEach(nome => {
    const ws = wb.Sheets[nome]; if (!ws) return;
    if (!funcs) { funcs = []; for (let i = 0; i < 4; i++) { const n = cellV(ws, 'A' + (6 + i)); const v = cellV(ws, 'B' + (6 + i)); if (n) funcs.push({ idx: i, nome: ('' + n).trim(), valor: parseFloat(v) || 0 }); } }
    const dias = []; const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    for (let r = 13; r <= range.e.r + 1; r++) {
      const a = cellV(ws, 'A' + r);
      if (typeof a === 'number' && a > 40000) {
        const reg = {};
        funcs.forEach(f => { const ef = cellV(ws, colE[f.idx] + r), sf = cellV(ws, colS[f.idx] + r), hc = cellV(ws, colH[f.idx] + r); let entrada = '', saida = '', horas = 0; if (typeof ef === 'number' && typeof sf === 'number' && (ef > 0 || sf > 0)) { entrada = fracHM(ef); saida = fracHM(sf); let dif = sf - ef; if (dif < 0) dif += 1; horas = Math.round(dif * 24 * 10000) / 10000; } else if (hc) { horas = Math.round((+hc) * 24 * 10000) / 10000; } reg[f.idx] = { entrada, saida, horas }; });
        const b = cellV(ws, 'B' + r); const dsem = (b == null ? '' : ('' + b)).trim();
        dias.push({ data: serialISO(a), diaSemana: dsem || diaSemanaPT(serialISO(a)), evento: ((cellV(ws, 'C' + r) || '') + '').trim(), obs: ((cellV(ws, 'Q' + r) || '') + '').trim(), reg });
      }
    }
    meses.push({ nome, dias });
  });
  return { funcs: funcs || [], meses };
}

function mesclar(db, p) {
  const byNome = {}; db.funcionarios.forEach(f => byNome[(f.nome || '').toLowerCase()] = f);
  p.funcs.forEach(pf => { const f = byNome[pf.nome.toLowerCase()]; if (f && pf.valor) f.valorHora = pf.valor; });
  let at = 0, nv = 0, seq = 0;
  p.meses.forEach(pm => {
    let mes = db.meses.find(m => (m.nome || '').toLowerCase() === pm.nome.toLowerCase());
    if (!mes) { mes = { id: 'm' + Date.now() + (seq++), nome: pm.nome, dias: [] }; db.meses.push(mes); }
    if (!mes.dias) mes.dias = [];
    pm.dias.forEach(pd => {
      const regApp = {};
      p.funcs.forEach(pf => { const f = byNome[pf.nome.toLowerCase()]; if (!f) return; const r = pd.reg[pf.idx] || { entrada: '', saida: '', horas: 0 }; regApp[f.id] = { entrada: r.entrada || '', saida: r.saida || '', horas: r.horas || 0 }; });
      const dia = mes.dias.find(d => d.data === pd.data && (d.evento || '').trim().toLowerCase() === (pd.evento || '').trim().toLowerCase());
      if (dia) { dia.diaSemana = pd.diaSemana; dia.evento = pd.evento; if (pd.obs) dia.obs = pd.obs; dia.reg = Object.assign(dia.reg || {}, regApp); at++; }
      else { mes.dias.push({ id: 'd' + Date.now() + (seq++), data: pd.data, diaSemana: pd.diaSemana, evento: pd.evento, obs: pd.obs, reg: regApp }); nv++; }
    });
  });
  return { at, nv };
}

module.exports = async (req, res) => {
  // DESLIGADO (jul/2026): o app passou a ser a fonte dos dados. A sincronização automática
  // com a planilha foi desativada para não sobrescrever o que é preenchido no app.
  res.status(200).json({ ok: false, desativado: 'sincronizacao automatica com a planilha desligada' });
  return;
  /* eslint-disable no-unreachable */
  const secret = process.env.CRON_SECRET || '';
  if (secret) { const auth = req.headers['authorization'] || ''; if (auth !== 'Bearer ' + secret) { res.status(401).json({ error: 'nao_autorizado' }); return; } }
  if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'kv_nao_configurado' }); return; }
  try {
    const db = await getData();
    const url = (db.config && db.config.sheetUrl) || '';
    const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/); const id = m ? m[1] : '';
    if (!id) { res.status(200).json({ ok: false, motivo: 'sem_link_planilha_salvo' }); return; }
    const r = await fetch('https://drive.google.com/uc?export=download&id=' + id, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) { res.status(502).json({ error: 'download_falhou', status: r.status }); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!(buf[0] === 0x50 && buf[1] === 0x4b)) { res.status(409).json({ error: 'planilha_nao_publica' }); return; }
    const parsed = parsePlanilha(buf);
    const resultado = mesclar(db, parsed);
    db.disponibilidade = db.disponibilidade || {}; db.funcoes = db.funcoes || []; db.config = db.config || {};
    await setData(db);
    res.status(200).json({ ok: true, atualizados: resultado.at, novos: resultado.nv, quando: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: String((e && e.message) || e) }); }
};
