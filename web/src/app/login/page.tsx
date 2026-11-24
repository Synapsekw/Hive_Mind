import { Logo } from "../../brand/Logo";
import { LoginForm } from "./login-form";
import { afterSignIn } from "./next";
import styles from "./login.module.css";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    next?: string | string[];
  }>;
}) {
  const { error, next } = await searchParams;
  const linkExpired = error === "link";
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <h1 className={styles.name}>
            <Logo />
          </h1>
        </div>
        <LoginForm
          configured={configured}
          linkExpired={linkExpired}
          next={afterSignIn(next)}
        />
      </div>
    </main>
  );
}
