import { LCT21001 } from '../../e-app/LCT21001';

describe('LCT21001', () => {
    it('clears stale bluetooth state during disconnect even when the device already dropped', async () => {
        const device = {
            isConnected: jasmine.createSpy('isConnected').and.resolveTo(false),
            disconnect: jasmine.createSpy('disconnect').and.resolveTo(),
        };
        const destroy = jasmine.createSpy('destroy');

        const cooler = new LCT21001() as any;
        cooler.device = device;
        cooler.adapter = { isDiscovering: jasmine.createSpy('isDiscovering').and.resolveTo(false) };
        cooler.uartTx = { some: 'tx' };
        cooler.uartRx = { some: 'rx' };
        cooler.connectedModel = 'LCT21001';
        cooler.destroy = destroy;

        await cooler.disconnect();

        expect(cooler.device).toBeUndefined();
        expect(cooler.adapter).toBeUndefined();
        expect(cooler.uartTx).toBeUndefined();
        expect(cooler.uartRx).toBeUndefined();
        expect(cooler.connectedModel).toBeUndefined();
        expect(destroy).toHaveBeenCalled();
    });
});
