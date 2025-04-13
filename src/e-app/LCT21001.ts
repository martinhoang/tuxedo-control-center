/*!
 * Copyright (c) 2022-2024 TUXEDO Computers GmbH <tux@tuxedocomputers.com>
 *
 * This file is part of TUXEDO Control Center.
 *
 * TUXEDO Control Center is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * TUXEDO Control Center is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with TUXEDO Control Center.  If not, see <https://www.gnu.org/licenses/>.
 */
import { createBluetooth } from 'node-ble';
import * as NodeBle from 'node-ble';

function sleep(ms: number, arg = 'timeout') {
    return new Promise(resolve => setTimeout(resolve, ms, arg));
}

const noop = () => {};

export enum RGBState {
    Static = 0x00,
    Breathe = 0x01,
    Colorful = 0x02,
    BreatheColor = 0x03
}

export enum PumpVoltage {
    V11 = 0x00,
    V12 = 0x01,
    V7 = 0x02,
    V8 = 0x03
}

export enum LCTDeviceModel {
    LCT21001 = 'LCT21001',
    LCT22002 = 'LCT22002',
}

export class DeviceInfo {
    uuid: string;
    name: string;
    rssi: number;
}

/**
 * Encapsulates communication with the Bluetooth LE device.
 */
export class LCT21001 {

    private static readonly NORDIC_UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    private static readonly NORDIC_UART_CHAR_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
    private static readonly NORDIC_UART_CHAR_RX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

    private static readonly CMD_RESET = 0x19;
    private static readonly CMD_FAN = 0x1b;
    private static readonly CMD_PUMP = 0x1c;
    private static readonly CMD_RGB = 0x1e;

    public static RGBState = RGBState;
    public static PumpVoltage = PumpVoltage;

    private adapter: NodeBle.Adapter | undefined;
    private device: NodeBle.Device | undefined;
    private uartRx: NodeBle.GattCharacteristic | undefined;
    private uartTx: NodeBle.GattCharacteristic | undefined;
    private destroy: (() => any) | undefined;

    private connectedModel: LCTDeviceModel | undefined;
    private userConfig: any;

    constructor(userConfig?: any) {
        this.userConfig = userConfig;
    }

    public getConnectedModel(): LCTDeviceModel | undefined {
        return this.connectedModel;
    }

    private async deviceModelFromName(name: string): Promise<LCTDeviceModel | undefined> {
        for (const model of Object.values(LCTDeviceModel)) {
            if (name.toLowerCase().includes(model.toLowerCase())) {
                return LCTDeviceModel[model];
            }
        }
        return undefined;
    }

    /**
     * Automatically scans and connects to the previously connected device if available.
     * @returns {Promise<boolean>} True if successfully connected, false otherwise.
     */
    async autoScanAndConnect(): Promise<boolean> {
        console.log('[AutoConnect] Starting...');
        let previouslyConnectedUUID;

        if (this.userConfig) {
            previouslyConnectedUUID = await this.userConfig.get('aquarisDeviceUUID');
            console.log(`[AutoConnect] Found previous UUID from config: ${previouslyConnectedUUID}`);
        }

        if (!previouslyConnectedUUID) {
            console.log('[AutoConnect] No previously connected device UUID found in config.');
            return false;
        }

        console.log('[AutoConnect] Starting discovery...');
        const isDiscovering = await this.startDiscover();
        if (!isDiscovering) {
            console.log('[AutoConnect] Failed to start discovery.');
            return false;
        }

        // Add a delay to allow time for devices to be found
        console.log('[AutoConnect] Waiting 2 seconds for discovery...');
        await sleep(2000); // Wait 2 seconds

        console.log('[AutoConnect] Getting device list...');
        const devices = await this.getDeviceList();
        console.log(`[AutoConnect] Found ${devices.length} potential Aquaris devices during scan.`);
        // It's often better to stop discovery *after* attempting connection,
        // but let's keep it here for now based on original logic.
        await this.stopDiscover();
        console.log('[AutoConnect] Stopped discovery.');

        const targetDevice = devices.find(device => device.uuid === previouslyConnectedUUID);
        if (!targetDevice) {
            console.log(`[AutoConnect] Previously connected device (${previouslyConnectedUUID}) not found in the scanned list.`);
            return false;
        }
        console.log(`[AutoConnect] Found target device in list: ${targetDevice.uuid} (${targetDevice.name})`);

        try {
            console.log(`[AutoConnect] Attempting to connect to ${targetDevice.uuid}...`);
            await this.connect(targetDevice.uuid); // connect() already saves the UUID via userConfig
            console.log(`[AutoConnect] Successfully connected to ${targetDevice.uuid}`);
            return true;
        } catch (err) {
            console.log(`[AutoConnect] Failed to connect to ${targetDevice.uuid}: ${err}`);
            // Ensure disconnect is called if connect fails partially
            await this.disconnect().catch(e => console.log(`[AutoConnect] Error during cleanup disconnect: ${e}`));
            return false;
        }
    }

    /**
     * Connect to device with given UUID
     */
    async connect(deviceUUID: string) {
        try {
            if (this.device !== undefined && await this.device.isConnected()) {
                await this.disconnect();
            }

            if (this.adapter === undefined) {
                const { bluetooth, destroy } = createBluetooth();
                this.destroy = destroy;
                this.adapter = await bluetooth.defaultAdapter();
            }

            this.device = await this.adapter.getDevice(deviceUUID);
            const deviceName = await this.device.getName();
            
            // Store the device UUID for future auto-connect
            if (this.userConfig) {
                await this.userConfig.set('aquarisDeviceUUID', deviceUUID);
            }
            
            // Create timeout promise to avoid hanging if connection fails
            const connectionTimeout = sleep(5000, 'timeout');
            const connect = this.device.connect();
            
            const result = await Promise.race([connect, connectionTimeout]);
            if (result === 'timeout') {
                await this.device.disconnect();
                throw new Error('Connection timeout');
            }

            const gattServer = await this.device.gatt();

            const uartService = await gattServer.getPrimaryService(LCT21001.NORDIC_UART_SERVICE_UUID);
            this.uartTx = await uartService.getCharacteristic(LCT21001.NORDIC_UART_CHAR_TX);
            this.uartRx = await uartService.getCharacteristic(LCT21001.NORDIC_UART_CHAR_RX);

            this.connectedModel = await this.deviceModelFromName(deviceName);
        } catch (err) {
            await this.disconnect();
            throw err;
        }
    }

    /**
     * Disconnect from device and clean-up bluetooth initializations
     */
    async disconnect() {
        if (this.device !== undefined && await this.device.isConnected()) {
            // Data written on disconnect by original control, seems to reset
            // or turn off configured parameters
            try { await this.writeReset(); } catch(err) {}
            try { await this.device.disconnect(); } catch (err) {}
            this.device = undefined;
            this.connectedModel = undefined;
        }
    }

    async startDiscover() {
        try {
            const { bluetooth, destroy } = createBluetooth();
            this.destroy = destroy;

            this.adapter = await bluetooth.defaultAdapter();

            if (! await this.adapter.isDiscovering()) {
                await this.adapter.startDiscovery();
            }

            return true;
        } catch (err) {
            return false;
        }
    }

    async stopDiscover() {
        // Clean-up other initialized stuff
        if (this.adapter !== undefined && await this.adapter.isDiscovering()) {
            await this.adapter.stopDiscovery().catch(noop);
        }

        if (this.destroy !== undefined) {
            this.destroy();
        }
    }

    async isDiscovering() {
        try {
            return await this.adapter?.isDiscovering();
        } catch (err) {
            return false;
        }
    }

    async getDeviceList() {
        const deviceIds = await this.adapter.devices();
        const deviceInfo = [];
        let blDevice;
        for (let deviceId of deviceIds) {
            try {
                blDevice = await this.adapter.getDevice(deviceId);
            } catch (err) {
                await blDevice.cleanup();
                continue;
            }
            const info = new DeviceInfo();
            info.uuid = deviceId;

            try {
                info.rssi = parseInt(await blDevice.getRSSI());
            } catch (err) {
                await blDevice.cleanup();
                continue;
            }

            try {
                info.name = await blDevice.getName();
            } catch (err) {
                info.name = '';
            }

            await blDevice.cleanup();

            const model = await this.deviceModelFromName(info.name);
            if (model !== undefined) {
                deviceInfo.push(info);
            }
        };

        return deviceInfo;
    }

    async isConnected() {
        let result;

        try {
            result = await this.device?.isConnected();
        } catch (err) {
            result = false;
        }

        if (result === undefined) {
            return false;
        } else {
            return result;
        }
    }

    /**
     * Write to the uart tx characteristic
     * 
     * @param buffer `Buffer` of data to write
     * 
     * Note: Throws error if not connected
     */
    async writeBuffer(buffer: Buffer) {
        if (this.uartTx !== undefined && await this.isConnected()) {
            await this.uartTx.writeValue(buffer, { type: 'request' });
        } else {
            throw Error('writeBuffer(): not connected');
        }
    }

    /**
     * Read from the uart rx characteristic
     * 
     * @returns A `Buffer` with the data read
     * 
     * Note: Throws error if not connected
     */
    async readBuffer() {
        if (this.uartRx !== undefined && await this.isConnected()) {
            return await this.uartRx.readValue();
        } else {
            throw Error('readBuffer(): not connected');
        }
    }

    /**
     * Write to the uart tx characteristic and wait for a
     * notification on the uart rx characteristic
     * 
     * @param inputBuffer `Buffer` to write to device
     * @returns A `Buffer` with the response
     * 
     * Note: Throws error if not connected
     */
    async writeReceive(inputBuffer: Buffer): Promise<Buffer> {
        return new Promise<Buffer>(async (resolve, reject) => {
            if (this.uartRx !== undefined && await this.isConnected()) {
                if (await this.uartRx.isNotifying()) {
                    reject('rx already awaiting notify');
                }
                await this.uartRx.startNotifications();
                this.uartRx.once('valuechanged', async outputBuffer => {
                    await this.uartRx?.stopNotifications();
                    resolve(outputBuffer);
                });
                this.writeBuffer(inputBuffer).catch(async () => {
                    await this.uartRx?.stopNotifications();
                    this.uartRx?.removeAllListeners();
                    reject()
                });
            } else {
                throw Error('writeReceive(): not connected');
            }
        });
    }

    /**
     * Write RGB color and state to device
     * 
     * @param red Red color 0-255
     * @param green Green color 0-255
     * @param blue Blue color 0-255
     * @param state Behaviour of light display
     */
    async writeRGB(red: number, green: number, blue: number, state: RGBState | number) {
        if (red < 0 || red > 0xff) throw Error('writeRGB(): param out of range');
        if (green < 0 || green > 0xff) throw Error('writeRGB(): param out of range');
        if (blue < 0 || blue > 0xff) throw Error('writeRGB(): param out of range');
        if (state < 0 || state > 0x03) throw Error('writeRGB(): param out of range');

        const data = Buffer.from([0xfe, LCT21001.CMD_RGB, 0x01, red, green, blue, state, 0xef]);
        await this.writeBuffer(data);
    }

    async writeRGBOff() {
        const data = Buffer.from([0xfe, LCT21001.CMD_RGB, 0x00, 0x00, 0x00, 0x00, 0x00, 0xef]);
        await this.writeBuffer(data);
    }

    /**
     * Write fan speed to device
     * 
     * @param dutyCyclePercent Fan speed in percent 0-100
     */
    async writeFanMode(dutyCyclePercent: number) {
        if (dutyCyclePercent < 0 || dutyCyclePercent > 0xff) throw Error('writeFanMode(): param out of range');
        const data = Buffer.from([0xfe, LCT21001.CMD_FAN, 0x01, dutyCyclePercent, 0x00, 0x00, 0x00, 0xef]);
        await this.writeBuffer(data);
    }

    async writeFanOff() {
        const data = Buffer.from([0xfe, LCT21001.CMD_FAN, 0x00, 0x00, 0x00, 0x00, 0x00, 0xef]);
        await this.writeBuffer(data);
    }

    /**
     * Write pump parameters to device
     * 
     * @param pumpDutyCyclePercent Duty cycle in percent 0-100
     * @param pumpVoltage See `PumpVoltage` for valid settings
     */
    async writePumpMode(pumpDutyCyclePercent?: number, pumpVoltage?: PumpVoltage | number) {
        if (pumpDutyCyclePercent === undefined) {
            pumpDutyCyclePercent = 60;
        }
        if (pumpDutyCyclePercent < 0 || pumpDutyCyclePercent > 100) throw Error('writePumpMode(): param out of range');
        if (pumpVoltage === undefined) {
            pumpVoltage = PumpVoltage.V8;
        }
        if (pumpVoltage < 0 || pumpVoltage > 0x03) throw Error('writePumpMode(): param out of range');

        const data = Buffer.from([0xfe, LCT21001.CMD_PUMP, 0x01, pumpDutyCyclePercent, pumpVoltage, 0x00, 0x00, 0xef]);
        await this.writeBuffer(data);
    }

    async writePumpOff() {
        const data = Buffer.from([0xfe, LCT21001.CMD_PUMP, 0x00, 0x00, 0x00, 0x00, 0x00, 0xef]);
        await this.writeBuffer(data);
    }

    /**
     * Read firmware version from device
     * 
     * @returns A `Buffer` representing a string describing the firmware version
     */
    async readFwVersion() {
        return await this.writeReceive(Buffer.from([0x73, 0x77]));
    }

    /**
     * Write (presumably) reset to device
     */
    async writeReset() {
        await this.writeBuffer(Buffer.from([0xfe, LCT21001.CMD_RESET, 0x00, 0x01, 0x00, 0x00, 0x00, 0xef]));
    }
}
