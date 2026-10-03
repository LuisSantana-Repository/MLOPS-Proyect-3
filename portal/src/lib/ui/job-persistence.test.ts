import { describe, expect, it } from "vitest";
import {
  browserStorage,
  JOB_STORAGE_KEY,
  jobIdFromSearch,
  recoverJobId,
  rememberJobId,
  withJobParam,
} from "./job-persistence";

/** Actividad A (6.1) — el job sobrevive a la recarga de /training. */

const ID = "11111111-2222-3333-4444-555555555555";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

describe("job en la URL", () => {
  it("lee ?job=<id>", () => {
    expect(jobIdFromSearch(`?job=${ID}`)).toBe(ID);
    expect(jobIdFromSearch("")).toBeNull();
  });

  it("ignora un valor que no tiene forma de id", () => {
    expect(jobIdFromSearch("?job=../../etc/passwd")).toBeNull();
    expect(jobIdFromSearch("?job=")).toBeNull();
  });

  it("agrega y quita ?job= conservando los demás parámetros", () => {
    expect(withJobParam("/training", "", ID)).toBe(`/training?job=${ID}`);
    expect(withJobParam("/training", "?x=1", ID)).toBe(`/training?x=1&job=${ID}`);
    expect(withJobParam("/training", `?x=1&job=${ID}`, null)).toBe("/training?x=1");
    expect(withJobParam("/training", `?job=${ID}`, null)).toBe("/training");
  });
});

describe("recuperar el job al cargar la página", () => {
  it("la URL manda sobre localStorage", () => {
    expect(recoverJobId(`?job=${ID}`, memoryStorage({ [JOB_STORAGE_KEY]: "otro-job" }))).toBe(ID);
  });

  it("sin ?job= usa el último job guardado", () => {
    expect(recoverJobId("", memoryStorage({ [JOB_STORAGE_KEY]: ID }))).toBe(ID);
    expect(recoverJobId("", memoryStorage())).toBeNull();
  });

  it("guarda y borra el job actual", () => {
    const storage = memoryStorage();
    rememberJobId(ID, storage);
    expect(storage.data.get(JOB_STORAGE_KEY)).toBe(ID);
    rememberJobId(null, storage);
    expect(storage.data.has(JOB_STORAGE_KEY)).toBe(false);
  });

  it("si localStorage está bloqueado no falla", () => {
    const blocked = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {},
    };
    expect(recoverJobId("", blocked)).toBeNull();
    expect(() => rememberJobId(ID, blocked)).not.toThrow();
  });
});

describe("browserStorage", () => {
  it("devuelve null si leer window.localStorage lanza (navegador que lo bloquea)", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        get localStorage(): never {
          throw new Error("SecurityError");
        },
      },
    });
    try {
      expect(browserStorage()).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, "window", original);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
});
