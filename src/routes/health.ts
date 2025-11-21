import { Router } from 'express';
import { appConfig } from '../config';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    service: 'snoopty-proxy',
    status: 'ok',
    upstream: appConfig.upstreamBaseUrl,
  });
});

export default router;
