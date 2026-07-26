import "dotenv/config";
import { jwtVerify } from "jose";

const secretKey = new TextEncoder().encode(process.env.JWT_SECRET ?? "change-me-in-production");
const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJvcGVuSWQiOiJsb2NhbF9yRkxGTFdoTU9TZVdwT3RtY0ZOZERWekEiLCJuYW1lIjoiQWRtaW4iLCJleHAiOjE3ODUwMTUyMzV9.QsB9r6T7hrcdeKX2IKWDh4Ogq96f2mHR1zPGxZPMCcM";

async function main() {
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
    console.log("Payload:", payload);
  } catch (e) {
    console.error("Error:", e.message);
  }
}
main();