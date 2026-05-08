import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "./prisma";

const APPROVAL_REQUIRED_ERROR = "approval_required";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.trim().toLowerCase();
      const name = user.name?.trim() || "이름 미등록";

      if (!email) {
        return "/login?error=invalid_email";
      }

      const existingUser = await prisma.user.findUnique({
        where: { email },
        select: { is_approved: true },
      });

      if (!existingUser) {
        await prisma.user.create({
          data: {
            email,
            name,
            is_approved: false,
          },
        });
        return `/login?error=${APPROVAL_REQUIRED_ERROR}`;
      }

      if (!existingUser.is_approved) {
        return `/login?error=${APPROVAL_REQUIRED_ERROR}`;
      }

      return true;
    },
    async jwt({ token }) {
      if (token.email) {
        const user = await prisma.user.findUnique({
          where: { email: token.email.toLowerCase() },
          select: { is_approved: true, name: true },
        });

        token.isApproved = user?.is_approved ?? false;
        token.name = user?.name ?? token.name;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.name = token.name;
        (session.user as { isApproved?: boolean }).isApproved = Boolean(token.isApproved);
      }

      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) {
        if (url === "/" || url.startsWith("/login")) {
          return `${baseUrl}/dashboard`;
        }
        return `${baseUrl}${url}`;
      }

      if (url.startsWith(baseUrl)) {
        if (url === baseUrl || url === `${baseUrl}/` || url.includes("/login")) {
          return `${baseUrl}/dashboard`;
        }
        return url;
      }

      return `${baseUrl}/dashboard`;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
