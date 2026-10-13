// Sessão do Banco de Horas: depois que a senha confere (api/login.js), o servidor entrega uma "chave de sessão" assinada.
// O app manda essa chave no header x-token em toda chamada; sem chave válida os dados não abrem.
// A assinatura usa a variável AUTH_SECRET da Vercel (nunca vai pro navegador nem pro repositório).
const crypto = require('crypto');

const TTL = 30 * 86400;                         // a sessão vale 30 dias
const segredo = () => process.env.AUTH_SECRET || '';

function assinar(payload) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', segredo()).update(p).digest('base64url');
}

function verificar(token) {
  if (!segredo() || typeof token !== 'string') return null;
  const [p, s] = token.split('.');
  if (!p || !s) return null;
  const esperado = crypto.createHmac('sha256', segredo()).update(p).digest('base64url');
  const a = Buffer.from(s), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let d; try { d = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!d || !d.u || !(d.e > Date.now() / 1000)) return null;
  return d;
}

// Usuário "de verdade" da sessão: confere no banco (se o papel mudou ou a pessoa foi removida, vale o que está no banco).
function usuarioDaSessao(req, dados) {
  const t = verificar(req.headers['x-token'] || '');
  if (!t) return null;
  return ((dados && dados.usuarios) || []).find(u => u.id === t.u) || null;
}

function igual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest(), hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { TTL, assinar, verificar, usuarioDaSessao, igual };
