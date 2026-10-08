import { describe, expect, it } from "vitest";
import { formatCpf, isValidCpf, normalizeCpf } from "./cpf";

describe("CPF", () => {
  it("normalizes and formats the document", () => {
    expect(normalizeCpf("529.982.247-25")).toBe("52998224725");
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
  });

  it("validates CPF check digits and rejects repeated digits", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
  });
});
