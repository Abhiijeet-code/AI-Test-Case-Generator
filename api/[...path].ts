import app from '../backend/src/index';

export default function (req: any, res: any) {
  if (!req.url.startsWith('/api')) {
    req.url = '/api' + req.url.replace(/^\//, ''); // e.g. /settings -> /api/settings
  }
  return app(req, res);
}
