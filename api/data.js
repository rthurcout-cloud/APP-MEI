// Função serverless do Vercel: lê e grava os dados compartilhados no Vercel KV (Upstash Redis).
//   GET  /api/data  -> retorna { funcionarios, meses, disponibilidade, funcoes, config, usuarios } (usuarios SEM as senhas)
//   POST /api/data  -> salva os dados
// Segurança:
//   - exige sessão (header x-token, entregue por /api/login). Sem sessão válida: 401 { error: 'login_necessario' }.
//   - as senhas nunca saem do servidor. Ao salvar, quem não manda a senha de um usuário mantém a que já estava.
//   - só ADMINISTRADOR altera usuários, funcionários (valor/hora), funções e configurações. Funcionário grava só agenda, escala e ponto.
//   - (se ACCESS_CODE estiver definido, continua exigindo também o header x-access-code.)
const { KV_URL, KV_TOKEN, DATA_KEY, kv } = require('./_util');
const { usuarioDaSessao } = require('./_auth');

const semSenha = u => { const o = Object.assign({}, u); delete o.senha; return o; };

module.exports = async (req, res) => {
  const required = process.env.ACCESS_CODE || '';
  const sent = req.headers['x-access-code'] || '';
  if (required && sent !== required) { res.status(401).json({ error: 'codigo_invalido' }); return; }
  if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'banco_nao_configurado' }); return; }
  if (!process.env.AUTH_SECRET) { res.status(500).json({ error: 'auth_nao_configurada' }); return; }
  try {
    const out = await kv(['GET', DATA_KEY]);
    const atual = out && out.result ? JSON.parse(out.result) : null;
    const instalacaoNova = !atual || !(atual.usuarios || []).length;      // banco ainda sem usuários: deixa criar o primeiro conjunto
    const quem = atual ? usuarioDaSessao(req, atual) : null;
    if (!quem && !instalacaoNova) { res.status(401).json({ error: 'login_necessario' }); return; }
    const admin = instalacaoNova || (quem && quem.papel === 'admin');

    if (req.method === 'GET') {
      const data = atual || { funcionarios: [], meses: [] };
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(Object.assign({}, data, { usuarios: (data.usuarios || []).map(semSenha) }));
      return;
    }
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      if (!body || typeof body !== 'object') { res.status(400).json({ error: 'body_invalido' }); return; }
      const safe = {
        funcionarios: Array.isArray(body.funcionarios) ? body.funcionarios : [],
        meses: Array.isArray(body.meses) ? body.meses : [],
        disponibilidade: (body.disponibilidade && typeof body.disponibilidade === 'object') ? body.disponibilidade : {},
        funcoes: Array.isArray(body.funcoes) ? body.funcoes : [],
        config: (body.config && typeof body.config === 'object') ? body.config : {},
        usuarios: Array.isArray(body.usuarios) ? body.usuarios : []
      };
      // Trava: nunca deixa um envio vazio apagar o banco (aparelho com defeito ou envio por engano).
      if (!safe.funcionarios.length && !safe.meses.length) {
        if (atual && ((atual.funcionarios || []).length || (atual.meses || []).length)) { res.status(409).json({ error: 'envio_vazio_recusado' }); return; }
      }
      if (atual && !instalacaoNova) {
        if (!admin) {
          // funcionário: só agenda/escala/ponto (meses e disponibilidade). O resto fica como já estava.
          safe.funcionarios = atual.funcionarios || []; safe.funcoes = atual.funcoes || []; safe.config = atual.config || {}; safe.usuarios = atual.usuarios || [];
        } else {
          // administrador: usuários vêm sem senha; quem não manda senha mantém a antiga; usuário novo precisa de senha.
          const antigos = Object.fromEntries((atual.usuarios || []).map(u => [u.id, u]));
          safe.usuarios = safe.usuarios.map(u => {
            const senha = (typeof u.senha === 'string' && u.senha) ? u.senha : (antigos[u.id] && antigos[u.id].senha);
            return senha ? Object.assign({}, u, { senha }) : null;
          }).filter(Boolean);
          if (!safe.usuarios.some(u => u.papel === 'admin' && u.senha)) { res.status(400).json({ error: 'precisa_de_um_administrador_com_senha' }); return; }
        }
      }
      // Ponto: cada lançamento tem um carimbo de hora (t). Se dois aparelhos salvam juntos, fica o mais
      // recente de cada pessoa em cada dia, em vez de um aparelho apagar o que o outro acabou de lançar.
      try {
        const velho = atual;
        if (velho && Array.isArray(velho.meses)) {
          const diasVelhos = {};
          velho.meses.forEach(m => (m.dias || []).forEach(d => { diasVelhos[d.id] = d; }));
          safe.meses.forEach(m => (m.dias || []).forEach(d => {
            const v = diasVelhos[d.id];
            if (!v || !v.reg) return;
            d.reg = d.reg || {};
            Object.keys(v.reg).forEach(fid => {
              const rv = v.reg[fid] || {}, rn = d.reg[fid];
              if (!rn || (+rv.t || 0) > (+rn.t || 0)) d.reg[fid] = rv;
            });
          }));
        }
      } catch (e) { /* se não conseguir ler o banco, salva como veio */ }
      await kv(['SET', DATA_KEY, JSON.stringify(safe)]);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'metodo_nao_suportado' });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
