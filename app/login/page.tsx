import LoginForm from "./login-form";

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const error = searchParams?.error ?? null;
  return (
    <LoginForm error={error} />
  );
}
