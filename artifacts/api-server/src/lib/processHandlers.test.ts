import test from "node:test";
import assert from "node:assert/strict";
import {
  handleUncaughtException,
  handleUnhandledRejection,
  isExplicitlyNonFatal,
  markNonFatal,
} from "./processHandlers";

test("only explicitly marked promise rejections keep the process alive", () => {
  const nonFatal = markNonFatal(new Error("expected background cancellation"));
  let exitCode: number | undefined;

  handleUnhandledRejection(nonFatal, (code) => {
    exitCode = code;
  });

  assert.equal(isExplicitlyNonFatal(nonFatal), true);
  assert.equal(exitCode, undefined);
});

test("unknown promise rejections are fatal", () => {
  let exitCode: number | undefined;

  handleUnhandledRejection(new Error("unexpected failure"), (code) => {
    exitCode = code;
  });

  assert.equal(exitCode, 1);
});

test("unknown uncaught exceptions are fatal", () => {
  let exitCode: number | undefined;

  handleUncaughtException(new Error("unexpected exception"), "uncaughtException", (code) => {
    exitCode = code;
  });

  assert.equal(exitCode, 1);
});

test("explicitly marked uncaught exceptions keep the process alive", () => {
  let exitCode: number | undefined;

  handleUncaughtException(
    markNonFatal(new Error("expected isolated exception")),
    "uncaughtException",
    (code) => {
      exitCode = code;
    },
  );

  assert.equal(exitCode, undefined);
});