import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEsptoolClient,
  type StatusPayload,
} from "../src/services/esptoolClient";
import { FakeSerialPort, loadTranscript } from "./helpers/esptool-transcript";

type StatusCapture = {
  statuses: StatusPayload[];
  onStatus: (payload: StatusPayload) => void;
};

const createStatusCapture = (): StatusCapture => {
  const statuses: StatusPayload[] = [];
  return {
    statuses,
    onStatus: payload => statuses.push(payload),
  };
};

const createTerminal = () => ({
  lines: [] as string[],
  writeLine(line: string) {
    this.lines.push(line);
  },
});

const createClient = (transcriptName: string) => {
  const port = new FakeSerialPort(loadTranscript(transcriptName));
  const terminal = createTerminal();
  const { statuses, onStatus } = createStatusCapture();
  const client = createEsptoolClient({
    port: port as unknown as SerialPort,
    terminal,
    debugSerial: false,
    debugLogging: false,
    onStatus,
  });
  return { client, port, statuses };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("tasmota-webserial-esptool wrapper contract", () => {
  it("connectAndHandshake reports status order and returns expected shape", async () => {
    const { client, port, statuses } = createClient("handshake");

    const result = await client.connectAndHandshake();

    const statusKeys = statuses
      .map(status => status.translationKey)
      .filter((key): key is string => Boolean(key));
    expect(statusKeys).toEqual([
      "dialogs.openingSerialPort",
      "dialogs.handshakingBootloader",
      "dialogs.loadingStubFlasher",
      "dialogs.gettingSecurityInfo",
    ]);

    expect(result).toMatchObject({
      chipName: "ESP32-H4",
      macAddress: "aa:bb:cc:dd:ee:ff",
      flashSize: null,
    });
    expect(result.securityFacts.length).toBeGreaterThan(0);

    port.assertNoPendingSteps();
    await port.close();
  });

  it("syncWithStub reports reconnecting status and completes", async () => {
    const { client, port, statuses } = createClient("handshake-reconnect");

    await client.connectAndHandshake();
    await client.syncWithStub();

    const reconnectStatus = statuses.find(
      status => status.translationKey === "dialogs.reconnectingStub",
    );
    expect(reconnectStatus).toBeTruthy();

    port.assertNoPendingSteps();
    await port.close();
  });

  it("timeout transcript maps to a SlipReadError", async () => {
    vi.useFakeTimers();
    const { client, port } = createClient("handshake-timeout");

    const promise = client.connectAndHandshake();
    const assertion = expect(promise).rejects.toMatchObject({
      name: "SlipReadError",
      message: expect.stringContaining("Timed out"),
    });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;

    port.assertNoPendingSteps();
    await port.close();
  });
});
