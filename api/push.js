// Inscrição do aparelho de cada funcionário nas notificações (Web Push). Exige sessão (x-token) e vale para a PRÓPRIA pessoa logada.
//   GET    /api/push  -> { publicKey }
//   POST   /api/push  -> { subscription } guarda (ou atualiza) a inscrição deste aparelho pro funcionário da sessão
//   DELETE /api/push  -> { endpoint } remove
const { KV_URL, KV_TOKEN, KEYS, kv, lerDados, acessoOk, lerCorpo } = require('./_util');
const { usuarioDaSessao } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!KV_URL || !KV_TOKEN) { res.status(500).json({ error: 'banco_nao_configurado' }); return; }
  try {
    if (req.method === 'GET') { res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' }); return; }
    if (req.method === 'POST' || req.method === 'DELETE') {
      if (!acessoOk(req, res)) return;
      const quem = usuarioDaSessao(req, await lerDados());
      if (!quem) { res.status(401).json({ error: 'login_necessario' }); return; }
      const body = lerCorpo(req);
      if (!body) { res.status(400).json({ error: 'body_invalido' }); return; }
      if (req.method === 'DELETE') {
        if (typeof body.endpoint !== 'string') { res.status(400).json({ error: 'endpoint_invalido' }); return; }
        await kv(['HDEL', KEYS.push, body.endpoint]);
        res.status(200).json({ ok: true }); return;
      }
      const sub = body.subscription;
      const okSub = sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000 &&
                    sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
      if (!okSub) { res.status(400).json({ error: 'inscricao_invalida' }); return; }
      if (!quem.funcId) { res.status(400).json({ error: 'funcionario_invalido' }); return; }     // ex.: a conta "Administrador" não é uma pessoa escalável
      await kv(['HSET', KEYS.push, sub.endpoint, JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, funcId: quem.funcId, criado: new Date().toISOString() })]);
      const n = await kv(['HLEN', KEYS.push]);
      res.status(200).json({ ok: true, inscritos: n.result });
      return;
    }
    res.status(405).json({ error: 'metodo_nao_suportado' });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
