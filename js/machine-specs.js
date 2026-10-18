import SPECS from '../assets/machines/specs.json' with { type: 'json' };
export const MACHINE_SPECS = Object.freeze(SPECS);
export const MACHINE_BY_TYPE = Object.freeze({ cnc: 'vf2', mill5: 'umc1250', turn: 'st40', press: 'nc1', pressfit: 'ep347', hem: 'oden' });
export function machineTech(type) {
  const s = MACHINE_SPECS[MACHINE_BY_TYPE[type]]; if (!s) return {};
  return { ReferenceManufacturer: s.manufacturer, ReferenceModel: s.model, SpecificationSource: s.source, GeometryBasis: s.geometryBasis,
    ...(s.axes ? { MachineAxes: s.axes } : {}), ...(s.travelMm ? { AxisTravelMm: s.travelMm.join(' / ') } : {}), ...(s.spindleRpm ? { MaxSpindleRPM: s.spindleRpm, SpindleRatingKW: s.spindlePowerKw } : {}),
    ...(s.maxPartSwingMm ? { MaxPartSwingB0Mm: s.maxPartSwingMm } : {}), ...(s.maxTurningDiameterMm ? { MaxTurningDiameterMm: s.maxTurningDiameterMm, MaxTurningLengthMm: s.maxTurningLengthMm } : {}),
    ...(s.forceKn ? { MaxPressForceKN: s.forceKn } : {}), ...(s.continuousForceKn ? { ContinuousPressForceKN: s.continuousForceKn, DutyBasis: s.dutyBasis } : {}), ...(s.strokeMm ? { RamStrokeMm: s.strokeMm } : {}),
    ...(s.forceRangeKn ? { PublishedPressForceRangeKN: s.forceRangeKn.join(' – '), SimulationStrokeMm: s.demoStrokeMm } : {}), ...(s.layoutSource ? { LayoutSource: s.layoutSource, LayoutRevision: s.layoutRevision ?? '제조사 공개 도면' } : {}) };
}
