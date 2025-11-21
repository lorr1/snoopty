import { Router } from 'express';
import { proxyAnthropicRequest } from '../proxy';

const router = Router();

router.use('/', async (req, res, next) => {
  try {
    await proxyAnthropicRequest(req, res);
  } catch (error) {
    next(error);
  }
});

export default router;
