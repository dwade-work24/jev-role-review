export interface AuthContext {
  readonly subject: string;
  readonly scopes: ReadonlySet<string>;
}

export type AuthContextResolver = (requestContext: unknown) =>
  | AuthContext
  | Promise<AuthContext>;

export class AuthorizationError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function requireScope(context: AuthContext, scope: string): void {
  if (!context.subject.trim() || !context.scopes.has(scope)) {
    throw new AuthorizationError();
  }
}
