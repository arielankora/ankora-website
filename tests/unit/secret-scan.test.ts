import { describe, expect, it } from "vitest";
import { findSecrets } from "@/lib/secret-scan";

describe("findSecrets", () => {
  it("catches what people say and paste", () => {
    expect(findSecrets("הסיסמה ל-Mercury היא Nux2026!").map((h) => h.kind)).toEqual(["PASSWORD"]);
    expect(findSecrets("password: hunter22").map((h) => h.kind)).toEqual(["PASSWORD"]);
    expect(findSecrets("the key is sk-ant-api03-abcdefghijklmnopqrstuv").map((h) => h.kind)).toContain("API_KEY");
    expect(findSecrets("AKIAIOSFODNN7EXAMPLE").map((h) => h.kind)).toEqual(["API_KEY"]);
    expect(findSecrets("-----BEGIN RSA PRIVATE KEY-----").map((h) => h.kind)).toEqual(["PRIVATE_KEY"]);
    expect(findSecrets("כרטיס 4580 1234 5678 9015 בתוקף").map((h) => h.kind)).toEqual(["CARD"]);
  });

  it("leaves ordinary facts alone", () => {
    expect(findSecrets("מגבלת Justworks: 25,000$ להעברה")).toEqual([]);
    expect(findSecrets("הזמנה מספר 1234567890123456 נשלחה")).toEqual([]);
    expect(findSecrets("ארבע הספרות האחרונות 4242")).toEqual([]);
    expect(findSecrets("משתמש נפרד ariel@nux.ai")).toEqual([]);
    expect(findSecrets("צריך לחדש את ה-passport של המנכ״ל")).toEqual([]);
    expect(findSecrets("הסיסמה נשלחה במייל נפרד")).toEqual([]);
    expect(findSecrets(null)).toEqual([]);
  });
});
