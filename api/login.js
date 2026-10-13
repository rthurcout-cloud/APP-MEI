// Login do Banco de Horas (a senha é conferida AQUI, no servidor).
//   GET  /api/login -> { usuarios: [{ id, nome, papel }] }  só pra montar a lista "Quem é você?" (sem senhas)
//   POST /api/login -> { id, senha }  =>  { token, user: { id, nome, papel, funcId } }
// Proteção contra tentativa em massa: depois de 10 erros seguidos numa conta, bloqueia por 15 minutos.
const { KV_URL, KV_TOKEN, kv, lerDados, lerCorpo } = require('./_util');
const { TTL, assinar, igual } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'banco_nao_configurado' }); return; }
  if (!process.env.AUTH_SECRET) { res.status(500).json({ error: 'auth_nao_configurada' }); return; }
  try {
    const d = await lerDados();
    if (req.method === 'GET') {
      res.status(200).json({ usuarios: (d.usuarios || []).map(u => ({ id: u.id, nome: u.nome, papel: u.papel })) });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'metodo_nao_suportado' }); return; }
    const body = lerCorpo(req);
    if (!body || typeof body.id !== 'string' || typeof body.senha !== 'string') { res.status(400).json({ error: 'body_invalido' }); return; }
    const chave = 'banco-horas:falhas:' + body.id.slice(0, 60);
    const falhas = parseInt(((await kv(['GET', chave])).result) || '0', 10);
    if (falhas >= 10) { res.status(429).json({ error: 'muitas_tentativas' }); return; }
    const u = (d.usuarios || []).find(x => x.id === body.id);
    if (!u || !u.senha || !igual(body.senha, u.senha)) {
      const n = (await kv(['INCR', chave])).result;
      if (n === 1) await kv(['EXPIRE', chave, '900']);
      res.status(401).json({ error: 'senha_incorreta' }); return;
    }
    await kv(['DEL', chave]);
    const token = assinar({ u: u.id, e: Math.floor(Date.now() / 1000) + TTL });
    res.status(200).json({ token, user: { id: u.id, nome: u.nome, papel: u.papel, funcId: u.funcId || '' } });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
