import { spawn } from "node:child_process";

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