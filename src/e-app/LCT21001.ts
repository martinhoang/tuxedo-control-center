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

        // Ensure adapter exists before trying to get device or scan
        if (this.adapter === undefined) {
            try {
                console.log('[AutoConnect] Adapter is undefined, creating new bluetooth instance for check...');
                const { bluetooth, destroy } = createBluetooth();
                this.destroy = destroy; // Store destroy for potential later cleanup
                this.adapter = await bluetooth.defaultAdapter();
                console.log('[AutoConnect] New bluetooth instance created.');
            } catch (err) {
                 console.log('[AutoConnect] Failed to create Bluetooth adapter:', err);
                 return false; // Cannot proceed without adapter
            }
        }

        // --- Check if already connected ---
        let alreadyConnected = false;
        try {
            console.log(`[AutoConnect] Checking connection status for ${previouslyConnectedUUID} before scanning...`);
            // Attempt to get the device handle directly
            const potentialDevice = await this.adapter.getDevice(previouslyConnectedUUID);
            if (potentialDevice) {
                console.log(`[AutoConnect] Got device handle for ${previouslyConnectedUUID}.`);
                this.device = potentialDevice; // Assign to class member
                alreadyConnected = await this.isConnected(); // Use the class method which returns boolean
                console.log(`[AutoConnect] isConnected status: ${alreadyConnected}`);
            } else {
                 console.log(`[AutoConnect] Could not get device handle for ${previouslyConnectedUUID} without scanning.`);
            }
        } catch (err) {
            console.log(`[AutoConnect] Error checking initial connection status for ${previouslyConnectedUUID}: ${err.message}. Proceeding to scan.`);
            alreadyConnected = false;
            this.device = undefined; // Clear potentially invalid device handle
        }

        if (alreadyConnected) {
            console.log(`[AutoConnect] Device ${previouslyConnectedUUID} appears connected. Attempting to reuse connection...`);
            try {
                // Try getting GATT services directly to validate the existing connection
                const gattServer = await this.device.gatt();
                const uartService = await gattServer.getPrimaryService(LCT21001.NORDIC_UART_SERVICE_UUID);
                this.uartTx = await uartService.getCharacteristic(LCT21001.NORDIC_UART_CHAR_TX);
                this.uartRx = await uartService.getCharacteristic(LCT21001.NORDIC_UART_CHAR_RX);
                // Get model name if possible
                try {
                     const deviceName = await this.device.getName();
                     this.connectedModel = await this.deviceModelFromName(deviceName);
                } catch (nameErr) {
                     console.log(`[AutoConnect] Could not get device name while reusing connection: ${nameErr.message}`);
                     this.connectedModel = undefined; // Or try a default?
                }
                console.log('[AutoConnect] Successfully reused existing connection and GATT services.');
                // Store UUID again in case it wasn't set properly before crash
                 if (this.userConfig) {
                    await this.userConfig.set('aquarisDeviceUUID', previouslyConnectedUUID);
                 }
                return true; // Successfully reused connection
            } catch (gattErr) {
                 console.log(`[AutoConnect] Failed to reuse existing connection (GATT error: ${gattErr.message}). Forcing reconnect...`);
                 // Fallback to forced reconnect if reusing GATT failed
                 try {
                     await this.connect(previouslyConnectedUUID); // connect() handles disconnect first
                     const verified = await this.isConnected();
                     console.log(`[AutoConnect] Forced reconnect successful: ${verified}`);
                     return verified;
                 } catch (reconnectErr) {
                      console.log(`[AutoConnect] Error during forced reconnect after GATT reuse failed: ${reconnectErr}`);
                      return false;
                 }
            }
        }

        // --- If not already connected, proceed with scanning ---
        console.log('[AutoConnect] Device not connected. Starting discovery...');
        const isDiscovering = await this.startDiscover(); // Uses existing or creates new adapter if needed
        if (!isDiscovering) {
            console.log('[AutoConnect] Failed to start discovery.');
            // Clean up adapter if we created it just for this attempt
            if (this.destroy) {
                this.destroy();
                this.destroy = undefined;
                this.adapter = undefined;
            }
            return false;
        }

        console.log('[AutoConnect] Waiting 2 seconds for discovery...');
        await sleep(2000);

        console.log('[AutoConnect] Getting device list...');
        const devices = await this.getDeviceList();
        console.log(`[AutoConnect] Found ${devices.length} potential Aquaris devices during scan.`);

        const targetDevice = devices.find(device => device.uuid === previouslyConnectedUUID);

        // Stop discovery *after* getting list and finding target, but *before* connecting
        // This seems necessary based on previous errors, keep adapter alive.
        await this.stopDiscover();
        console.log('[AutoConnect] Stopped discovery.');

        if (!targetDevice) {
            console.log(`[AutoConnect] Previously connected device (${previouslyConnectedUUID}) not found in the scanned list.`);
            // Clean up adapter if we created it just for this attempt
             if (this.destroy) {
                 this.destroy();
                 this.destroy = undefined;
                 this.adapter = undefined;
             }
            return false;
        }
        console.log(`[AutoConnect] Found target device in list: ${targetDevice.uuid} (${targetDevice.name})`);

        let connected = false;
        try {
            console.log(`[AutoConnect] Attempting to connect to ${targetDevice.uuid}...`);
            await this.connect(targetDevice.uuid); // connect() uses existing adapter if available
            connected = await this.isConnected();
            if (connected) {
                console.log(`[AutoConnect] Successfully connected to ${targetDevice.uuid} after scan.`);
            } else {
                 console.log(`[AutoConnect] connect() method finished but isConnected() is false after scan.`);
            }
        } catch (err) {
            console.log(`[AutoConnect] Failed to connect to ${targetDevice.uuid} after scan: ${err}`);
            await this.disconnect().catch(e => console.log(`[AutoConnect] Error during cleanup disconnect: ${e}`));
            connected = false;
        } finally {
             // Clean up adapter if we created it just for this attempt
             // Note: This might disconnect if connect() succeeded but didn't set its own adapter/destroy
             // Need careful testing. For now, let's assume connect manages the adapter state if successful.
             // if (this.destroy && !connected) { // Only destroy if we created it AND failed? Risky.
             //     this.destroy();
             //     this.destroy = undefined;
             //     this.adapter = undefined;
             // }
        }
        return connected;
    }

    /**
     * Connect to device with given UUID
     */
    async connect(deviceUUID: string) {
        try {
            if (this.device !== undefined && await this.device.isConnected()) {
                await this.disconnect();
            }

            // Ensure adapter exists, create if necessary (should usually exist if called from autoScanAndConnect)
            if (this.adapter === undefined) {
                 console.log('[Connect] Adapter is undefined, creating new bluetooth instance...');
                const { bluetooth, destroy } = createBluetooth();
                // IMPORTANT: We should manage this destroy function carefully.
                // If called from autoScanAndConnect, the destroy from there should be used.
                // If called directly, this new destroy needs handling on disconnect/cleanup.
                // For now, let's assume autoScanAndConnect manages the primary destroy.
                // If this causes issues, we might need a more robust singleton pattern for the adapter.
                 if (!this.destroy) { // Only assign if not already set by another process like autoScan
                     this.destroy = destroy;
                 }
                this.adapter = await bluetooth.defaultAdapter();
                 console.log('[Connect] New bluetooth instance created.');
            } else {
                 console.log('[Connect] Using existing adapter.');
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

        // Removed destroy() call - adapter should persist until explicit disconnect or app exit
        // if (this.destroy !== undefined) {
        //     this.destroy();
        // }
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
