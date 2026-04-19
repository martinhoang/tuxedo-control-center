import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { ElectronService } from 'ngx-electron';

import { AquarisControlComponent } from './aquaris-control.component';
import { UtilsService } from '../utils.service';

describe('AquarisControlComponent', () => {
  let component: AquarisControlComponent;
  let fixture: ComponentFixture<AquarisControlComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AquarisControlComponent],
      imports: [ReactiveFormsModule],
      providers: [
        {
          provide: ElectronService,
          useValue: {
            ipcRenderer: {
              send: jasmine.createSpy('send'),
              invoke: jasmine.createSpy('invoke').and.resolveTo(undefined)
            }
          }
        },
        { provide: MatDialog, useValue: {} },
        { provide: UtilsService, useValue: { confirmDialog: jasmine.createSpy('confirmDialog').and.resolveTo({ confirm: true, noBother: false }) } }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(AquarisControlComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('starts periodic discovery even when not initially connected', async () => {
    spyOn<any>(component, 'getUserDeviceNames').and.resolveTo(new Map());
    spyOn<any>(component, 'periodicUpdate').and.resolveTo();
    spyOn(window, 'setInterval').and.returnValue(1 as any);
    (component as any).aquaris = {
      isConnected: jasmine.createSpy('isConnected').and.resolveTo(false)
    };

    await component.initCommunication();

    expect((component as any).periodicUpdate).toHaveBeenCalled();
    expect(window.setInterval).toHaveBeenCalled();
  });
});
