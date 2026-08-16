export interface AuthSessionResult {
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number;
  confirmationRequired: boolean;
}

export interface LoginAttemptProof {
  rateKeyHash: string;
  requestTimestamp: number;
  signature: string;
}

export interface AuthGateway {
  authorizeLoginAttempt(proof: LoginAttemptProof): Promise<void>;
  login(email: string, password: string): Promise<AuthSessionResult>;
  changePassword(accessToken: string, currentPassword: string, newPassword: string): Promise<AuthSessionResult>;
}

export const authorizeLoginAttempt = (gateway: AuthGateway, proof: LoginAttemptProof) => gateway.authorizeLoginAttempt(proof);
export const loginAdmin = (gateway: AuthGateway, email: string, password: string) => gateway.login(email, password);
export const changeAdminPassword = (gateway: AuthGateway, accessToken: string, currentPassword: string, newPassword: string) => gateway.changePassword(accessToken, currentPassword, newPassword);
