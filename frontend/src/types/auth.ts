export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export interface User {
  id: number;
  email: string;
  phone_number: string | null;
  name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  isProfileComplete: boolean;
  isLoading: boolean;
}
