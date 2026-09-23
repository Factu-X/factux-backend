import type { RolUsuario } from "../modules/auth/types.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        nombre: string;
        rol: RolUsuario;
        activo: boolean;
      };
    }
  }
}

export {};
