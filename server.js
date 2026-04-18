import express from 'express';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 8080;
const distDir = path.join(__dirname, 'dist');

app.use(
  express.static(distDir, {
    immutable: true,
    maxAge: '1y',
  }),
);

app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
