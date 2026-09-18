import { spawn } from "node:child_process";

export interface ProcessRunner {
  run(command: string, args: string[], options?: { env?: NodeJS.ProcessEnv; quiet?: boolean }): Promise<void>;
  capture(command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }): Promise<{ code: number; stdout: string; stderr: string }>;
}

export const processRunner: ProcessRunner = {
  run,
  capture: runCapture,
};

export async function run(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    quiet?: boolean;
  } = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: options.quiet ? "ignore" : "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `${command} ${args.join(" ")} failed${signal ? ` with signal ${signal}` : ` with exit code ${code ?? "unknown"}`}`,
      ));
    });
  });
}

export async function runCapture(command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}