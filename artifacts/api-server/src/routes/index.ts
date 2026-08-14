import { Router, type IRouter } from "express";
import healthRouter from "./health";
import integrationsRouter from "./integrations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(integrationsRouter);

export default router;
