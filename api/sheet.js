// Baixa a planilha do Google Drive (xlsx compartilhado por link) e devolve os bytes.
// Serve de "ponte" (proxy) porque o navegador não consegue baixar do Google direto (CORS).
// Protegido pelo mesmo ACCESS_CODE do resto do app.

module.exports = async (req, res) => {
  const required = process.env.ACCESS_CODE || '';
  const sent = req.headers['x-access-code'] || '';
  if (required && sent !== required) { res.status(401).json({ error: 'codigo_invalido' }); return; }

  const id = (req.query && req.query.id) ? String(req.query.id) : '';
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(id)) { res.status(400).json({ error: 'id_invalido' }); return; }

  try {
    const r = await fetch('https://drive.google.com/uc?export=download&id=' + id, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!r.ok) { res.status(502).json({ error: 'download_falhou', status: r.status }); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    // valida que veio um xlsx (assinatura PK) e não uma página de login
    if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
      res.status(409).json({ error: 'nao_publico', dica: 'A planilha precisa estar compartilhada como "qualquer pessoa com o link pode ver".' });
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
