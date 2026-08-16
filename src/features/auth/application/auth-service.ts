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

export interface OperatorSignupCommand {
  departmentName: string;
  teamName: string;
  displayName: string;
  email: string;
  password: string;
}

export interface AuthGateway {
  authorizeLoginAttempt(proof: LoginAttemptProof): Promise<void>;
  authorizeSignupAttempt(proof: LoginAttemptProof): Promise<void>;
  login(email: string, password: string): Promise<AuthSessionResult>;
  signup(command: OperatorSignupCommand, emailRedirectTo: string, proof: LoginAttemptProof): Promise<AuthSessionResult>;
  changePassword(accessToken: string, currentPassword: string, newPassword: string): Promise<AuthSessionResult>;
}

export const authorizeLoginAttempt = (gateway: AuthGateway, proof: LoginAttemptProof) => gateway.authorizeLoginAttempt(proof);
export const authorizeSignupAttempt = (gateway: AuthGateway, proof: LoginAttemptProof) => gateway.authorizeSignupAttempt(proof);
export const loginAdmin = (gateway: AuthGateway, email: string, password: string) => gateway.login(email, password);
export const signupOperator = (gateway: AuthGateway, command: OperatorSignupCommand, emailRedirectTo: string, proof: LoginAttemptProof) => gateway.signup(command, emailRedirectTo, proof);
export const changeAdminPassword = (gateway: AuthGateway, accessToken: string, currentPassword: string, newPassword: string) => gateway.changePassword(accessToken, currentPassword, newPassword);
