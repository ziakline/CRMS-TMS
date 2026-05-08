import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user?: DefaultSession["user"] & {
      isApproved?: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    isApproved?: boolean;
  }
}
