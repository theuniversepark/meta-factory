# Manufacturer-reference presses and machine tools

Checked 2026-10-18 Asia/Seoul. These are Blender reconstructions from manufacturer specifications, installation drawings and product photographs. They are not manufacturer CAD files or certified process integrations. Dimensions are metres in the model, millimetres in the specification JSON. Housings without published component dimensions are reconstructed by proportion; shipping-pallet dimensions are not used as machine sizes.

| Application | Reference product | Published values applied |
|---|---|---|
| Generic CNC station | Haas VF-2 | XYZ 762/406/508 mm; 914×356 mm table; 889 mm table height; 864 mm opening; 8,100 rpm; 20-tool carousel |
| Adaptive five-axis cells | Haas UMC-1250 | XYZ 1270/762/711 mm; Ø762 mm platter; 991 mm maximum B0 swing; 914 mm approximate table height; 1193 mm opening; B tilt −35°…120°; 8,100 rpm; 30+1 tools |
| Adaptive turning cell | Haas ST-40 | Ø381 mm chuck; 762 mm max BOT-turret cutting diameter; 1118 mm max cutting length; X/Z 508/1118 mm; 2,400 rpm; 12 turret stations |
| Forming press station | AIDA NC1-1100(2)E | 1,100 kN; 180 mm stroke; 350 mm die height; 630×520 mm slide; 1,070×680 mm bolster; 35–65 spm no-load range |
| Precision press-fit station | SCHMIDT ElectricPress 347 + frame 35 | 20 kN peak at S3 25%, 10 seconds; 13 kN continuous; 150 mm stroke; 100 mm/s maximum ram speed; 300×220 mm worktable; 300×475 mm mount |
| Flexible hemming cell | AP&T ODEN-F reference architecture | Manufacturer range 1,000–12,000 kN. Hemming die, bed, envelope and 300 mm demonstration stroke are custom simulation choices; this is not a claimed standard OEM hemming product. |

Manufacturer sources:

- VF-2 product: https://www.haascnc.com/machines/vertical-mills/vf-series/models/small/vf-2.html
- VF-2 layout, November 2015 Revision A: https://www.haascnc.com/content/dam/haascnc/pdp_feed/mld/VF-2_2015-11.pdf
- UMC-1250 product: https://www.haascnc.com/machines/vertical-mills/universal-machine/models/umc-1250.html
- UMC-1250 public draft layout, 18 April 2022: https://pub-aem.haascnc.com/content/dam/haascnc/pdp_feed/mld/umc-1250_ss_mld_04_2022.pdf
- ST-40 archived layout (November 2016): https://www.haascnc.com/content/dam/haascnc/pdp_feed/mld/ST-40_2016-11.pdf
- ST-40 current specification: https://www.haascnc.com/content/haascnc/en/machines/compare-machines.ST-40.html
- AIDA NC1-E specifications, Japanese manufacturer table: https://www.aida.co.jp/en/products/product2.html
- SCHMIDT current product specification (peak/continuous force distinguished): https://www.schmidttechnology.de/produkte/maschinen/schmidt-electricpress/
- SCHMIDT dimensions, Electric Presses catalogue, page IV 05: https://www.schmidttechnology.de/en/products/press-systems/servopress/schmidt-electrical-presses-en/
- AP&T ODEN-F product and capacity range: https://www.aptgroup.com/solutions/lines-products/hydraulic-presses/oden-f

The Haas public layout revisions are explicitly retained; they may differ from a newly delivered machine or selected options. Spindle power is a manufacturer's spindle rating, not whole-machine average electrical consumption. Existing cell cycle times, throughput and energy estimates remain simulation assumptions, not OEM performance claims. Displayed rotary animation speed is deliberately reduced to avoid visual aliasing; the spec/AAS contains the manufacturer's maximum RPM.

Implementation:

- Shared source: assets/machines/specs.json. JS metadata and Blender geometry consume this same source.
- Build: blender -b --python blender/build_product_machines.py
- Outputs: assets/blender/{haas_vf2,haas_umc1250,haas_st40,aida_nc1,schmidt_ep347,apt_oden}.{glb,blend} and preview PNGs.
- GLB doors export at the closed origin; runtime slides them open. Native Blender preview files open with access doors open.
- UMC has separate B tilt (machine Y / application Z) and C table rotation (machine Z / application Y). Workpieces follow the table.
- ST-40 has a horizontal spindle, chuck and three jaws; X/Z turret movement stays within the published travel limits.
- New pressure strokes translate rigid ram nodes; no artificial ram elongation.
- Machining stops while the door is open. Robot loading targets use the actual exported fixture datum.
- Async asset completion refreshes persistent zone-equipment subtrees before crews are built. Mode changes retain cell identities.
- Equipment information panels and AAS technical data include the reference product, key published values, source and reconstruction basis.

Checks:

    node tests/product-machines.mjs
    npx electron tools/check-product-machines.cjs

Validation report: outputs/machine-upgrade/validation.json. Static geometry checks compare physical worktable/platter/chuck/bolster/slide dimensions. Electron checks stroke bounds, servo speed, open-door interlock, horizontal spindle rotation, XYZ clearance, frozen stop and actual installed models/AAS in all three modes.

Work record context: Outlook and Teams profiles were verified as jin.park@camtic.or.kr; the narrow press/machining-centre query found no relevant records. Manufacturer sources above are the evidence used. KakaoTalk records were not accessible in this session.

Current workpieces: the 660×620 mm hydraulic block has an approximately 905 mm diagonal, below the UMC-1250 991 mm B0 swing but above its 762 mm platter diameter. Its demonstration therefore keeps B at zero. The 460×430 mm rear cover has an approximately 630 mm diagonal, below the ST-40 maximum cutting diameter. These are preliminary envelope checks, not fixture, collision-free tilt or process certifications. Custom hemming tooling uses a 1750×1300 mm bed for the hood/door envelopes.
