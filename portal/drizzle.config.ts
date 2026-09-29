import { defineConfig } from "drizzle-kit";

const url =
  process.env.DATABASE_URL ??
  `mysql://${process.env.MYSQL_USER ?? "mlflow_user"}:${
    process.env.MYSQL_PASSWORD ?? "mlflow_password"
  }@${process.env.MYSQL_HOST ?? "127.0.0.1"}:${process.env.MYSQL_PORT ?? "3307"}/${
    process.env.MYSQL_DATABASE ?? "mlflow_db"
  }`;

export default defineConfig({
  dialect: "mysql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
