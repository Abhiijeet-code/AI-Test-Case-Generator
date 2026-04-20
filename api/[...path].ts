import app from '../backend/src/index';

export default function (req: any, res: any) {
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + req.url.replace(/^\//, ''); // e.g. /generate -> /api/generate
  }
  return app(req, res);
}
