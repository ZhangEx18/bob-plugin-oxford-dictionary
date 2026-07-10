type CryptoJsLike = {
  MD5(input: string): { toString(encoder?: unknown): string };
  enc: { Hex: unknown };
};

type NodeCryptoLike = {
  createHash(algorithm: string): {
    update(input: string): { digest(encoding: "hex"): string };
  };
};

let cryptoJsModule: CryptoJsLike | null | undefined;
let nodeCryptoModule: NodeCryptoLike | null | undefined;

function runtimeRequire(id: string): unknown {
  return (Function("return require")() as (moduleId: string) => unknown)(id);
}

function loadHashModules(): void {
  if (cryptoJsModule !== undefined && nodeCryptoModule !== undefined) return;
  try {
    cryptoJsModule = runtimeRequire("crypto-js") as CryptoJsLike;
  } catch {
    cryptoJsModule = null;
  }
  try {
    nodeCryptoModule = runtimeRequire("node:crypto") as NodeCryptoLike;
  } catch {
    nodeCryptoModule = null;
  }
}

export function md5(input: string): string {
  loadHashModules();
  if (cryptoJsModule) {
    return cryptoJsModule.MD5(input).toString(cryptoJsModule.enc.Hex);
  }
  if (nodeCryptoModule) {
    return nodeCryptoModule.createHash("md5").update(input).digest("hex");
  }
  throw new Error("No MD5 implementation available");
}
