import { Router } from "express";

import { authenticate } from "../../middlewares/auth.js";

export const authRouter = Router();

authRouter.get("/me", authenticate, (req, res) => {
  res.json({ data: req.user });
});
