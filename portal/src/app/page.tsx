import { redirect } from "next/navigation";

/** La entrada del portal unificado es el Tablero del portal de anotación. */
export default function Home() {
  redirect("/dashboard");
}
