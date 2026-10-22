import type { RequestHandler } from "express";

import { supabase } from "../config/supabase.js";
import { db } from "../prisma/db.js";
import { forbidden, unauthorized } from "../shared/http-error.js";
import type { RolUsuario } from "../modules/auth/types.js";

const getBearerToken = (authorizationHeader: string | undefined) => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
};

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = getBearerToken(req.header("Authorization"));

    if (!token) {
      throw unauthorized();
    }

    // getClaims verifica la firma localmente con las llaves publicas del proyecto (JWKS en cache),
    // sin ir a Supabase en cada peticion. Desactivar un usuario sigue siendo inmediato: ver profile.activo.
    const { data, error } = await supabase.auth.getClaims(token);
    const userId = data?.claims.sub;

    if (error || !userId) {
      throw unauthorized("Token invalido o expirado");
    }

    const profile = await db.orm.public.Profiles.first({ id: userId });

    if (!profile) {
      throw unauthorized("El usuario autenticado no tiene profile asociado");
    }

    if (!profile.activo) {
      throw forbidden("El usuario esta inactivo");
    }

    req.user = {
      id: profile.id,
      nombre: profile.nombre,
      rol: profile.rol,
      activo: profile.activo,
    };

    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole =
  (...roles: RolUsuario[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }

    if (!roles.includes(req.user.rol)) {
      next(forbidden());
      return;
    }

    next();
  };
