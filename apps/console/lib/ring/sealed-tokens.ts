import { tokenResponseSchema, type TokenResponse } from "@visitproof/ring-partner-sdk"

import type { TokenCipher } from "./token-cipher"

/** Seal and open a Ring token set; the opened value is re-validated with Zod. */
export const sealTokens = (cipher: TokenCipher, tokens: TokenResponse): Promise<string> =>
  cipher.encrypt(JSON.stringify(tokens))

export const openTokens = async (cipher: TokenCipher, payload: string): Promise<TokenResponse> =>
  tokenResponseSchema.parse(JSON.parse(await cipher.decrypt(payload)))
