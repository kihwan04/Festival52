export interface AuthSessionResult {
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number;
  confirmationRequired: boolean;
}

export interface AuthGateway {
  login(email: string, password: string): Promise<AuthSessionResult>;
  setup(email: string, password: string, displayName: string, redirectTo: string): Promise<AuthSessionResult>;
}

export const loginAdmin = (gateway: AuthGateway, email: string, password: string) => gateway.login(email, password);
export const setupFirstAdmin = (gateway: AuthGateway, email: string, password: string, displayName: string, redirectTo: string) => gateway.setup(email, password, displayName, redirectTo);
