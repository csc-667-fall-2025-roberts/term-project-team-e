import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    if (!req.session.userId) {
        if (req.accepts('html')) return res.redirect(303, '/');
        return res.status(401).json({ error: 'Unauthorized - Please log in' });
    }
    next();
}


// export function requireGuest(req: Request, res: Response, next: NextFunction) {
//     if (req.session.userId) {
//         if (req.accepts('html')) return res.redirect(303, '/lobby');
//         return res.status(409).json({ error: 'Already logged in' });
//     }
//     next();
// }


export function attachUser(req: Request, _res: Response, next: NextFunction) {
    if (req.session.userId) {
        (req as any).userId = req.session.userId;
        (req as any).username = req.session.username;
    }
    next();
}
