import { NextFunction, Request, Response } from 'express';
import { ZodTypeAny } from 'zod';

/**
 * Valida (e normaliza) o corpo da requisição com um schema zod.
 * Corpo ausente é tratado como `{}`; campos desconhecidos são descartados.
 */
export function validateBody(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue?.path.join('.') || 'corpo';
      res.status(400).json({
        error: `Dados inválidos: ${field} (${issue?.message ?? 'formato incorreto'}).`,
        field,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
