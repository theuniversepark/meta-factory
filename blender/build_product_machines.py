"""Reconstruct machines in Blender from published dimensions and manufacturer layouts.
Published working dimensions are enforced; housings and custom peripherals are reconstructions.
Run blender -b --python blender/build_product_machines.py
"""
from pathlib import Path
import json
BASE=Path(__file__).resolve().parents[1]
# Reuse the project's metric geometry/export helpers, without running the asset build.
source=(BASE/'blender/build_assets.py').read_text().split("exec(compile(open(os.path.join")[0]
exec(compile(source,'build_assets_helpers','exec'))
from mathutils import Vector
OUT=Path(OUT)
SPECS=json.loads((BASE/'assets/machines/specs.json').read_text())
T=lambda x,y,z:(x,-z,y)
S=lambda w,h,d:(w,d,h)
def B(n,size,pos,m,p,bevel=.01):return box(n,S(*size),T(*pos),m,bevel=bevel,parent=p)
def C(n,r,h,pos,m,p,axis='Y',verts=48):return cyl(n,r,h,T(*pos),m,axis={'X':'X','Y':'Z','Z':'Y'}[axis],parent=p,verts=verts,bevel=.002)
def E(n,pos=(0,0,0),p=None):return empty(n,T(*pos),p)
def text(n,body,pos,size,m,p):
 c=bpy.data.curves.new(n,'FONT');c.body=body;c.size=size;c.extrude=.0003;c.align_x='CENTER'
 o=bpy.data.objects.new(n,c);bpy.context.collection.objects.link(o);o.parent=p;o.location=T(*pos);o.rotation_euler=(math.pi/2,0,0);c.materials.append(m)
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');return o

def start(key):
 reset();MATS.clear();common_mats();r=E(SPECS[key]['asset']);r['machine_spec']=key
 r['manufacturer']=SPECS[key]['manufacturer'];r['model']=SPECS[key]['model'];r['source']=SPECS[key]['source'];r['geometry_basis']=SPECS[key]['geometryBasis'];r['spec_json']=json.dumps(SPECS[key],ensure_ascii=False)
 mat('HaasRed',srgb('#b3202a'),.1,.35);mat('MachineWhite',srgb('#e6e7e6'),.15,.38);mat('MachineDark',srgb('#24282c'),.3,.42);mat('Screen',srgb('#1b4863'),0,.3,emit=srgb('#2f90bd'),strength=.35);mat('AidaPaint',srgb('#dce5d9'),.1,.42);mat('SchmidtGreen',srgb('#009883'),.1,.4)
 return r

def controller(r,x,y,z,brand):
 d=MATS['MachineDark'];w=MATS['MachineWhite'];st=MATS['Steel'];screen=MATS['Screen']
 B('PendantSupport',(.065,.8,.065),(x,y-.55,z-.09),st,r)
 panel=E('ControlPendant',(x,y,z),r);B('Pendant',(.42,.65,.13),(0,0,0),d,panel,.025)
 B('ControlScreen',(.33,.23,.008),(0,.13,.071),screen,panel,.004)
 for row in range(5):
  for col in range(9):B(f'Key_{row}_{col}',(.024,.022,.007),(-.14+col*.035,-.08-row*.035,.072),w,panel,.002)
 C('JogDial',.035,.012,(.115,-.25,.078),st,panel,axis='Z');C('EStop',.022,.022,(-.12,-.25,.082),mat('EmergencyRed',srgb('#e33926')),panel,axis='Z')
 text('ControlBrand',brand,(0,.275,.073),.035,w,panel)
 return screen

def feet(r,w,d):
 for x in (-w*.4,w*.4):
  for z in (-d*.35,d*.35):C('LevelingFoot',.075,.07,(x,.035,z),MATS['Steel'],r)

def enclosure(r,w,d,h,opening,doorTravel,model):
 white=MATS['MachineWhite'];dark=MATS['MachineDark'];red=MATS['HaasRed'];steel=MATS['Steel'];front=d/2
 B('BaseCasting',(w,.38,d),(0,.26,0),dark,r,.045)
 B('RearCasting',(w-.1,h-.45,.15),(0,(h+.45)/2,-d/2+.075),white,r,.02)
 for sd in (-1,1):
  B('SidePanel',(.10,h-.45,d),(sd*(w/2-.05),(h+.45)/2,0),white,r,.015)
  # A real window opening rather than glass over an opaque wall.
  pw=(w-opening)/2
  B('FrontCheek',(pw,h-.45,.09),(sd*(opening/2+pw/2),(h+.45)/2,front),white,r)
 B('Roof',(w,.09,d),(0,h-.045,0),white,r)
 B('Header',(w,.18,.10),(0,h-.25,front+.01),red,r)
 text('ModelMark','HAAS  '+model,(0,h-.28,front+.067),.10,white,r)
 B('FrontSill',(opening,.16,.12),(0,.53,front),dark,r)
 door=E('Door',(0,0,front+.07),r);height=h-.86;cy=.61+height/2;winH=.64;winY=cy+.15
 for sd in(-1,1):B('DoorStile',(.075,height,.045),(sd*(opening/2-.0375),cy,0),white,door)
 B('DoorLower',(opening,max(.1,winY-winH/2-.61),.045),(0,(.61+winY-winH/2)/2,0),white,door)
 B('DoorUpper',(opening,.20,.045),(0,h-.51,0),white,door)
 B('DoorGlass',(opening-.15,winH,.025),(0,winY,0),mat('SafetyGlass',srgb('#27404a'),.2,.13,alpha=.24),door,.002)
 for sd in(-1,1):B('WindowSeal',(.023,winH+.03,.03),(sd*(opening/2-.073),winY,.013),dark,door,.003)
 B('DoorHandle',(.028,.30,.040),(opening*.35,cy,.05),steel,door,.01)
 B('DoorRail',(opening+doorTravel+.1,.035,.04),(doorTravel*.45,h-.39,front+.075),steel,r)
 feet(r,w,d)
 controller(r,w/2-.1,1.42,front+.30,'HAAS')
 # Chips and coolant peripherals are illustrative reconstructions, kept outside the working area.
 conv=E('ChipConveyor',(-w/2-.18,.26,-.25),r);B('ConveyorTrough',(.34,.22,1.3),(0,0,0),dark,conv)
 B('ChipBin',(.46,.44,.43),(0,-.01,.82),white,conv)
 B('ElectricalCabinet',(.58,.9,.25),(w*.22,.95,-d/2-.14),white,r)
 for i in range(12):B('CabinetVent',(.38,.009,.006),(w*.22,.7+i*.025,-d/2-.27),dark,r,.001)
 return front

def mill(key):
 r=start(key);sp=SPECS[key];umc=key=='umc1250';w,d,h=(3.40,2.80,3.00) if umc else (1.981,2.286,2.311)
 front=enclosure(r,w,d,h,sp['doorOpeningMm']/1000,sp['doorTravelMm']/1000,sp['model'])
 th=sp['tableHeightMm']/1000;fz=.20 if umc else .34
 B('Saddle',(.8,.20,.65),(0,th-.24,fz),MATS['MachineDark'],r,.04)
 # Original XYZ structure: table Y, table X, spindle Z.
 yaxis=E('YSlide',(0,0,0),r);xaxis=E('XSlide',(0,0,0),yaxis)
 if umc:
  cradle=E('Cradle',(0,th-.12,fz),xaxis)
  for sd in(-1,1):C('TrunnionBearing',.12,.14,(0,0,sd*.48),MATS['MachineDark'],cradle,axis='Z')
  tilt=E('Tilt',(0,0,0),cradle);rotary=E('Rotary',(0,.08,0),tilt)
  C('Platter',sp['platterDiameterMm']/2000,.08,(0,0,0),MATS['Steel'],rotary)
  for x in(-.189,-.126,-.063,0,.063,.126,.189):B('TSlot',(.010,.004,.68),(x,.041,0),MATS['MachineDark'],rotary,.001)
  E('Fixture',(0,.04,0),rotary)
 else:
  table=E('Table',(0,th-.045,fz),xaxis);B('WorkTable',(.914,.09,.356),(0,0,0),MATS['Steel'],table,.006)
  for z in(-.125,0,.125):B('TSlot',(.91,.004,.016),(0,.046,z),MATS['MachineDark'],table,.001)
  E('Fixture',(0,.045,0),table)
 # Head origin is the spindle nose, guaranteeing published nose-to-table clearance.
 head=E('Head',(0,th+sp['spindleGapMm'][1]/1000,fz),r)
 B('SpindleHead',(.38,.48,.38),(0,.28,0),MATS['MachineWhite'],head,.03)
 spin=E('Spindle',(0,0,0),head);C('SpindleNose',.065,.08,(0,.04,0),MATS['Steel'],spin)
 C('ToolHolder',.035,.08,(0,-.04,0),MATS['MachineDark'],spin);C('EndMill',.01,.06,(0,-.11,0),MATS['Steel'],spin,verts=24)
 B('ZColumn',(.42,h-.4,.33),(0,(h+.4)/2,-.57),MATS['MachineDark'],r)
 for yy in range(14):B('AxisBellows',(.37,.012,.06),(0,1.1+yy*.05,-.37),MATS['Bumper'],r,.001)
 # Native carousel / side magazine tool counts are preserved.
 magazine=E('ATC',(-w*.32,1.75,-.35),r);count=20 if not umc else 30
 C('ToolMagazine',.24,.05,(0,0,0),MATS['MachineDark'],magazine)
 for i in range(count):
  a=i*math.tau/count;C('ATCTool_'+str(i),.012,.11,(math.cos(a)*.205,-.06,math.sin(a)*.205),MATS['Steel'],magazine,verts=12)
 # Manufacturing sample is sized to the actual platter / table, not stretched AMR product geometry.
 B('DemoWorkpiece',(.19,.075,.14),(0,.04,0),MATS['Steel'],bpy.data.objects['Fixture'],.01)
 return r

def lathe():
 r=start('st40');sp=SPECS['st40'];enclosure(r,3.80,2.2,2.413,sp['doorOpeningMm']/1000,sp['doorTravelMm']/1000,'ST-40')
 height=1.041;z=.26
 B('SlantBed',(1.5,.28,.7),(0,.65,0),MATS['MachineDark'],r)
 B('Headstock',(.42,.65,.52),(-.76,1.02,z),MATS['MachineWhite'],r,.035)
 chuck=E('Chuck',(-.53,height,z),r)
 C('ChuckBody',sp['chuckDiameterMm']/2000,.16,(0,0,0),MATS['Steel'],chuck,axis='X')
 for i in range(3):
  a=i*math.tau/3;o=B('ChuckJaw',(.065,.035,.055),(.065,math.sin(a)*.125,math.cos(a)*.125),MATS['MachineDark'],chuck,.004);o.rotation_euler.x=-a
 C('TurningSample',.045,.20,(.16,0,0),MATS['Steel'],chuck,axis='X')
 E('Fixture',(.13,0,0),chuck)
 turret=E('Turret',(.2,1.2,z-.18),r);C('TurretDisc',.17,.12,(0,0,0),MATS['MachineDark'],turret,axis='X',verts=12)
 for i in range(12):
  a=i*math.tau/12;B('TurretTool_'+str(i),(.11,.018,.022),(-.11,math.sin(a)*.145,math.cos(a)*.145),MATS['Steel'],turret,.002)
 B('Tailstock',(.25,.33,.27),(.73,height,z),MATS['MachineWhite'],r);C('TailstockQuill',.028,.24,(.48,height,z),MATS['Steel'],r,axis='X')
 return r

def press():
 r=start('nc1');paint=MATS['AidaPaint'];dark=MATS['MachineDark'];steel=MATS['Steel']
 B('Foot',(1.42,.20,1.20),(0,.10,-.20),paint,r,.045)
 B('BolsterPedestal',(1.20,.72,.84),(0,.54,0),paint,r,.055)
 B('Bolster',(1.070,.13,.680),(0,.935,0),steel,r,.004)
 for x in(-.4,-.2,0,.2,.4):B('BolsterSlot',(.016,.004,.65),(x,1.002,0),dark,r,.001)
 # Gap-frame opening, rear spine and cantilever crown.
 B('CFrameSpine',(.70,2.45,.60),(0,1.75,-.62),paint,r,.09)
 B('Crown',(1.32,.75,1.18),(0,2.60,-.20),paint,r,.06)
 C('Flywheel',.37,.16,(.78,2.57,-.35),dark,r,axis='X');C('FlywheelCover',.39,.10,(.86,2.57,-.35),paint,r,axis='X')
 ram=E('Ram',(0,1.61,0),r);B('Slide',(.630,.16,.520),(0,0,0),paint,ram,.025)
 B('UpperDie',(.52,.25,.44),(0,-.205,0),steel,ram,.008)
 B('LowerDie',(.62,.10,.48),(0,1.05,0),dark,r,.006)
 E('Fixture',(0,1.10,0),r)
 for x in(-.37,.37):B('SlideGuide',(.07,.63,.13),(x,1.63,-.14),steel,r,.006)
 text('AidaMark','AIDA',(0,2.60,.405),.18,MATS['MachineDark'],r);text('AidaModel','NC1-1100(2)E',(0,2.38,.405),.075,dark,r)
 controller(r,.95,1.20,.28,'AIDA')
 for x in(-.66,.66):
  B('LightCurtain',(.035,1.1,.045),(x,1.25,.40),MATS['Yellow'],r)
  for j in range(14):B('CurtainLens',(.018,.018,.007),(x,.76+j*.075,.426),dark,r,.001)
 return r

def electric():
 r=start('ep347');w=MATS['MachineWhite'];dark=MATS['MachineDark'];green=MATS['SchmidtGreen'];steel=MATS['Steel']
 stand=E('CustomWorkStand',p=r);B('Bench',(.70,.06,.68),(0,.85,0),dark,stand)
 for x in(-.29,.29):
  for z in(-.25,.25):B('StandLeg',(.045,.80,.045),(x,.40,z),dark,stand)
 # Official frame 35: height 688 mm, mount 300x475 mm, work table 300x220 mm.
 frame=E('Frame35',(0,.88,0),r);B('FrameMount',(.300,.141,.475),(0,.0705,-.08),steel,frame,.006)
 B('RearFrame',(.17,.59,.16),(0,.39,-.22),w,frame,.025)
 B('WorkTable',(.300,.020,.220),(0,.151,.02),steel,frame,.004)
 drive=E('Drive347',(0,.55,.02),frame);B('DriveEnvelope',(.298,.464,.261),(0,.232,0),w,drive,.015)
 B('DriveCover',(.26,.08,.265),(0,.41,0),green,drive)
 ram=E('Ram',(0,.48,.02),frame);C('Quill',.0215,.19,(0,-.095,0),steel,ram)
 C('PressTool',.025,.025,(0,-.20,0),dark,ram)
 E('Fixture',(0,.165,.02),frame)
 text('SchmidtMark','SCHMIDT',(0,.79,.157),.035,dark,frame)
 controller(r,.40,1.25,.12,'PressControl')
 return r

def oden():
 r=start('oden');white=MATS['MachineWhite'];dark=MATS['MachineDark'];steel=MATS['Steel'];blue=mat('OdenBlue',srgb('#166397'),.1,.4)
 B('MonoblockBase',(2.35,.65,1.60),(0,.325,0),blue,r,.06)
 for x in(-1.06,1.06):B('MonoblockPillar',(.27,2.65,1.50),(x,1.7,0),blue,r,.05)
 B('Crown',(2.35,.55,1.60),(0,3.05,0),white,r,.03)
 B('CustomHemmingBed',(1.75,.12,1.30),(0,.71,0),steel,r)
 ram=E('Ram',(0,1.35,0),r);B('Slide',(1.75,.25,1.30),(0,0,0),steel,ram)
 B('CustomHemmingUpperDie',(1.65,.12,1.20),(0,-.19,0),dark,ram)
 E('Fixture',(0,.82,0),r)
 for x in(-.5,.5):C('HydraulicCylinder',.11,1.1,(x,2.25,0),dark,r);C('RamRod',.045,.65,(x,1.7,0),steel,r)
 text('OdenMark','AP&T  ODEN-F',(0,3.02,.812),.13,dark,r);text('ConceptMark','CUSTOM HEMMING TOOLING',(0,.35,.812),.06,white,r)
 controller(r,1.25,1.30,.35,'AP&T');return r

def save(r,key):
 export(r,SPECS[key]['asset'])
 if 'doorTravelMm' in SPECS[key]: bpy.data.objects['Door'].location.x = SPECS[key]['doorTravelMm']/1000
 # Editable source includes a lit product view; no preview objects in GLB.
 pts=[];bpy.context.view_layer.update()
 for o in r.children_recursive:
  if o.type=='MESH':pts.extend(o.matrix_world@Vector(c)for c in o.bound_box)
 lo=Vector([min(p[i]for p in pts)for i in range(3)]);hi=Vector([max(p[i]for p in pts)for i in range(3)]);center=(lo+hi)/2;span=max(hi-lo)
 bpy.ops.mesh.primitive_plane_add(size=20);bpy.context.object.data.materials.append(mat('PreviewFloor',srgb('#69747e'),0,.8))
 bpy.ops.object.camera_add(location=center+Vector((span*1.2,-span*2.0,span*.65)));cam=bpy.context.object;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=52;bpy.context.scene.camera=cam
 for offset,power in [((2,-3,5),1800),((-3,-1,3),1200)]:
  bpy.ops.object.light_add(type='AREA',location=center+Vector(offset));light=bpy.context.object;light.data.energy=power;light.data.size=4;light.rotation_euler=(center-light.location).to_track_quat('-Z','Y').to_euler()
 sc=bpy.context.scene;sc.world=bpy.data.worlds.new('PreviewWorld');sc.world.color=(.16,.16,.16);sc.render.engine='BLENDER_EEVEE';sc.render.resolution_x=1000;sc.render.resolution_y=1000;sc.render.resolution_percentage=100;sc.render.filepath=str(OUT/('preview_'+SPECS[key]['asset']+'.png'))
 bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(SPECS[key]['asset']+'.blend')));bpy.ops.render.render(write_still=True)
for key,build in [('vf2',lambda:mill('vf2')),('umc1250',lambda:mill('umc1250')),('st40',lathe),('nc1',press),('ep347',electric),('oden',oden)]:save(build(),key)
