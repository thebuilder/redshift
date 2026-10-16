# REDSHIFT car: procedural Blender build (run inside Blender, e.g. exec(open(path).read())).
# Writes car.glb (copy it to src/assets/car.glb) and redshift_car.blend into REDSHIFT_OUT
# (defaults to the current working directory).
import os
OUT_DIR = os.environ.get('REDSHIFT_OUT', os.getcwd())
import bpy, bmesh, math
from mathutils import Vector, Matrix

sc = bpy.data.scenes['RedshiftCar']
bpy.context.window.scene = sc
# wipe everything in this scene (cutters too), keep materials
for o in list(sc.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for c in list(sc.collection.children):
    sc.collection.children.unlink(c)

def mat(name, col, metal=0.0, rough=0.4, emit=None, estr=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = estr
    return m

M = {
 'Paint': mat('Paint', (0.86,0.86,0.85), 0.1, 0.25),
 'Glass': mat('Glass', (0.05,0.035,0.025), 0.3, 0.05),
 'Trim': mat('Trim', (0.02,0.02,0.022), 0.4, 0.5),
 'Tire': mat('Tire', (0.012,0.012,0.012), 0.0, 0.85),
 'Rim': mat('Rim', (0.7,0.7,0.69), 0.6, 0.3),
 'Spoke': mat('Spoke', (0.02,0.02,0.025), 0.5, 0.35),
 'LightFront': mat('LightFront', (1,1,1), 0, 0.3, (1,1,1), 8),
 'LightRear': mat('LightRear', (1,0.02,0.04), 0, 0.3, (1,0.02,0.04), 8),
 'Nozzle': mat('Nozzle', (0.45,0.33,0.2), 0.95, 0.28),
 'Interior': mat('Interior', (0.03,0.028,0.03), 0.0, 0.7),
 'Seat': mat('Seat', (0.06,0.05,0.05), 0.0, 0.55),
 'Screen': mat('Screen', (0.1,0.02,0.03), 0, 0.2, (1,0.15,0.2), 4),
 'Carbon': mat('Carbon', (0.035,0.035,0.04), 0.6, 0.3),
}

def link(ob):
    sc.collection.objects.link(ob)
    return ob

def catmull(keys, n):
    out = []; K = len(keys)
    for s in range(n):
        u = s/(n-1)*(K-1); i = min(int(u), K-2); t = u - i
        p0 = keys[max(i-1,0)]; p1 = keys[i]; p2 = keys[i+1]; p3 = keys[min(i+2,K-1)]
        out.append(tuple(0.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t) for a,b,c,d in zip(p0,p1,p2,p3)))
    return out

KEY = [ # x, w, zb, zs, zsh, zd, zt
 (2.42,.56,.425,.43,.445,.455,.46),
 (2.36,.76,.31,.33,.475,.505,.512),
 (2.20,.88,.22,.29,.54,.585,.595),
 (1.90,.955,.19,.30,.65,.70,.70),
 (1.45,.995,.19,.31,.745,.805,.79),
 (1.00,1.0,.19,.32,.775,.835,.845),
 (0.40,.995,.19,.33,.795,.858,.875),
 (-0.40,.995,.19,.34,.83,.885,.90),
 (-1.20,1.0,.19,.35,.865,.915,.925),
 (-1.80,.995,.20,.365,.89,.935,.945),
 (-2.20,.96,.25,.41,.90,.945,.95),
 (-2.37,.91,.32,.48,.895,.935,.94),
]
ST = catmull(KEY, 30)
def at(x):
    for i in range(len(ST)-1):
        a,b = ST[i], ST[i+1]
        if a[0] >= x >= b[0]:
            t = (a[0]-x)/(a[0]-b[0]); return tuple(p+(q-p)*t for p,q in zip(a,b))
    return ST[0] if x > ST[0][0] else ST[-1]

def finish(ob, smooth_angle=22):
    me = ob.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    return ob

def loft_half(name, rings, faceMat, mats, skip=None):
    """build a full (mirrored) closed loft directly, so winding is consistent"""
    bm = bmesh.new()
    full = []
    for r in rings:
        left = r                         # y >= 0 side, bottom-centre -> top-centre
        right = [(x, -y, z) for (x, y, z) in reversed(r[1:-1])]
        full.append(left + right)
    R = [[bm.verts.new(p) for p in ring] for ring in full]
    n = len(R[0]); half = len(rings[0]) - 1
    drop = []
    for i in range(len(R)-1):
        for j in range(n):
            jj = (j+1) % n
            f = bm.faces.new((R[i][j], R[i+1][j], R[i+1][jj], R[i][jj]))
            # map j back to the half-profile index for material lookup
            hj = j if j < half else (n - 1 - j)
            f.material_index = faceMat(i, hj)
            if skip and skip(i, hj): drop.append(f)
    f = bm.faces.new(R[0]); f.material_index = faceMat(-1, -1)
    f = bm.faces.new(list(reversed(R[-1]))); f.material_index = faceMat(-2, -2)
    if drop:
        bmesh.ops.delete(bm, geom=drop, context='FACES')
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(M[m])
    ob = link(bpy.data.objects.new(name, me))
    return finish(ob)

def bevel(ob, w=0.01):
    bv = ob.modifiers.new('Bevel','BEVEL'); bv.limit_method='ANGLE'; bv.angle_limit=math.radians(24); bv.width=w; bv.segments=2; bv.harden_normals=True

# ------------------------------------------------------------ body
rings = []
for (x,w,zb,zs,zsh,zd,zt) in ST:
    prof = [(0,zb),(w-0.18,zb),(w-0.05,zb+0.08),(w-0.02,zs),(w,zs+0.10),(w-0.01,zsh),(w-0.14,zd),(w*0.45,zt-0.01),(0,zt)]
    rings.append([(x,y,z) for (y,z) in prof])
def bodyMat(i, j):
    if i < 0: return 1 if i == -1 else 0
    if j <= 1: return 1                      # only the underside + lower chamfer is dark now
    if i <= 1 and j <= 4: return 1           # undercut front fascia
    return 0
body = loft_half('Body', rings, bodyMat, ['Paint','Trim'])
for nm, x, r, sd in (('CutFL',1.45,0.43,1),('CutFR',1.45,0.43,-1),('CutRL',-1.45,0.44,1),('CutRR',-1.45,0.44,-1)):
    me = bpy.data.meshes.new(nm); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=64, radius1=r, radius2=r, depth=0.62)
    bm.to_mesh(me); bm.free()
    c = link(bpy.data.objects.new(nm, me)); c.location = (x, sd*0.96, 0.335); c.rotation_euler = (math.pi/2, 0, 0)
    c.hide_render = True; c.display_type = 'WIRE'
    b = body.modifiers.new('Arch'+nm, 'BOOLEAN'); b.operation='DIFFERENCE'; b.object = c; b.solver='EXACT'
# hollow out the cockpit so the cabin is a real space under the glass
me = bpy.data.meshes.new('CutCabin'); bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
for v in bm.verts: v.co = Vector((v.co.x*2.34, v.co.y*1.6, v.co.z*1.0))
bm.to_mesh(me); bm.free(); me.materials.append(M['Interior'])
cc = link(bpy.data.objects.new('CutCabin', me)); cc.location = (-0.04, 0, 0.85); cc.hide_render = True; cc.display_type = 'WIRE'
if len(body.data.materials) < 3: body.data.materials.append(M['Interior'])
b = body.modifiers.new('Cabin', 'BOOLEAN'); b.operation='DIFFERENCE'; b.object = cc; b.solver='EXACT'; b.material_mode = 'TRANSFER'
bevel(body)

# ------------------------------------------------------------ greenhouse (frame + glass)
GK = [(1.30,.68,None),(1.05,.665,0.93),(0.6,.65,1.07),(0.1,.64,1.17),(-0.5,.63,1.225),(-0.95,.625,1.235),
 (-1.30,.60,1.215),(-1.70,.545,1.14),(-2.05,.46,1.05),(-2.31,.36,0.965)]
G = catmull([(x,rw,(zr if zr else at(x)[5]+0.002)) for (x,rw,zr) in GK], 24)
grings = []
for (x,rw,zr) in G:
    _,w,_,_,_,zd,_ = at(x)
    bw = w - 0.14
    zr = max(zr, zd + 0.002)
    k = min(1, (zr-zd)/0.12)
    grings.append([(x,0,zd-0.02),(x,bw,zd),(x,bw-0.035*k,zd+0.04*k),(x,rw+0.07*k,zr-0.035*k),(x,rw,zr),(x,rw-0.11*k,zr+0.008*k),(x,0,zr+0.014*k)])
xs = [g[0] for g in G]
def ghMat(i, j):
    if i < 0: return 0
    xm = (xs[i]+xs[i+1])/2
    if j == 2 and xm > -1.32: return 1
    if j == 5 and xm > -1.32: return 1
    if j == 5 and -2.0 < xm < -1.5: return 1
    return 0
gh = loft_half('Greenhouse', grings, ghMat, ['Paint','Glass'], skip=lambda i, j: j == 0)
bevel(gh, 0.008)
# glass gets its own object so the game can render it transparent
bpy.ops.object.select_all(action='DESELECT')

# ------------------------------------------------------------ helpers for parts
def cyl(name, r, depth, loc, rot=(0,0,0), mat_='Nozzle', seg=24, caps=True, r2=None):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=seg, radius1=r, radius2=r2 if r2 else r, depth=depth)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me)); o.location = loc; o.rotation_euler = rot
    o.data.materials.append(M[mat_])
    return finish(o, 35)

def box(name, size, loc, mat_, rot=(0,0,0), bev=0.0):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts: v.co = Vector((v.co.x*size[0], v.co.y*size[1], v.co.z*size[2]))
    bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me)); o.location = loc; o.rotation_euler = rot
    o.data.materials.append(M[mat_])
    if bev:
        b = o.modifiers.new('Bevel','BEVEL'); b.width = bev; b.segments = 2
    return finish(o, 35)

def nozzle(name, loc, axis, length=0.11):
    """bronze pipe with a dark bore, aimed along axis (the blast direction)"""
    ax = Vector(axis).normalized()
    q = Vector((0,0,1)).rotation_difference(ax)
    o = cyl(name, 0.045, length, loc, mat_='Nozzle', caps=False, r2=0.038)
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = q
    s = o.modifiers.new('Solid','SOLIDIFY'); s.thickness = 0.01
    bore = cyl(name+'_bore', 0.036, 0.004, Vector(loc) - ax*(length*0.35), mat_='Trim', seg=16)
    bore.rotation_mode = 'QUATERNION'; bore.rotation_quaternion = q
    return o

# ------------------------------------------------------------ air-blast nozzles (must match NOZZLES in CarSim.ts)
# game frame: x fwd, y up (COM at 0.55), z right  ->  blender: (x, -z, y+0.55)
def g2b(x, y, z): return (x, -z, y + 0.55)
NOZ = [
 ('NzFLd', (1.0, -0.40, -0.86), (0,0,-1)), ('NzFRd', (1.0, -0.40, 0.86), (0,0,-1)),
 ('NzRLd', (-1.0, -0.40, -0.86), (0,0,-1)), ('NzRRd', (-1.0, -0.40, 0.86), (0,0,-1)),
 ('NzFLu', (1.62, 0.18, -0.70), (0,0,1)), ('NzFRu', (1.62, 0.18, 0.70), (0,0,1)),
 ('NzRLu', (-1.95, 0.38, -0.88), (0,0,1)), ('NzRRu', (-1.95, 0.38, 0.88), (0,0,1)),
 ('NzFL', (2.15, -0.12, -0.86), (0,1,0)), ('NzFR', (2.15, -0.12, 0.86), (0,-1,0)),
 ('NzRL', (-2.2, 0.05, -0.92), (0,1,0)), ('NzRR', (-2.2, 0.05, 0.92), (0,-1,0)),
]
def surf_top(x, lat):
    _,w,_,_,zsh,zd,zt = at(x)
    edge = w - 0.14
    if lat <= edge: t = (lat - w*0.45) / max(1e-3, edge - w*0.45); return zt + (zd - zt) * max(0, min(1, t))
    t = (lat - edge) / max(1e-3, (w - 0.01) - edge); return zd + (zsh - zd) * max(0, min(1, t))
for k, (nm, p, ax) in enumerate(NOZ):
    b = list(g2b(*p))
    if 4 <= k < 8:      # flush ports on the hood / rear deck
        b[2] = surf_top(b[0], abs(b[1])) + 0.008
        nozzle(nm, b, ax, 0.04)
    elif k >= 8:        # flush ports on the corners
        b[1] = (1 if b[1] > 0 else -1) * (at(b[0])[1] - 0.012)
        nozzle(nm, b, ax, 0.05)
    else:
        nozzle(nm, b, ax)
# down pipes hang from little pods under the sill
for nm, p, ax in NOZ[:4]:
    b = g2b(*p)
    box(nm+'_pod', (0.16, 0.12, 0.08), (b[0], b[1], 0.215), 'Carbon', bev=0.015)

# ------------------------------------------------------------ lights, aero, trim
box('LightBarF', (0.03, 1.12, 0.022), (2.405, 0, 0.452), 'LightFront')
box('LightBarR', (0.03, 1.80, 0.032), (-2.372, 0, 0.885), 'LightRear')
box('LightLowR', (0.02, 1.3, 0.012), (-2.36, 0, 0.56), 'LightRear')
box('Splitter', (0.36, 1.62, 0.024), (2.24, 0, 0.2), 'Carbon', bev=0.008)
box('SkirtL', (1.9, 0.045, 0.05), (0.0, 0.975, 0.215), 'Carbon', bev=0.01)
box('SkirtR', (1.9, 0.045, 0.05), (0.0, -0.975, 0.215), 'Carbon', bev=0.01)
# rear diffuser with strakes and quad exhausts
box('Diffuser', (0.55, 1.62, 0.16), (-2.18, 0, 0.27), 'Carbon', bev=0.02)
for i, y in enumerate((-0.62, -0.31, 0.0, 0.31, 0.62)):
    box(f'Strake{i}', (0.4, 0.018, 0.1), (-2.22, y, 0.21), 'Carbon', rot=(0, -0.18, 0))
for i, y in enumerate((-0.47, -0.16, 0.16, 0.47)):
    o = cyl(f'Exhaust{i}', 0.055, 0.1, (-2.405, y, 0.41), rot=(0, math.pi/2, 0), mat_='Nozzle', caps=False, r2=0.05)
    s = o.modifiers.new('Solid','SOLIDIFY'); s.thickness = 0.012
    cyl(f'Exhaust{i}_bore', 0.044, 0.004, (-2.39, y, 0.41), rot=(0, math.pi/2, 0), mat_='Trim', seg=16)
box('ExhaustPanel', (0.06, 1.3, 0.16), (-2.39, 0, 0.41), 'Carbon', bev=0.01)
box('Plate', (0.01, 0.34, 0.11), (-2.375, 0, 0.66), 'Rim')

# active rear wing: pivot at the mounting point, chord runs backwards
wingP = Vector((-2.28, 0, 1.22))
me = bpy.data.meshes.new('Wing'); bm = bmesh.new()
chord, span, th = 0.46, 1.86, 0.035
prof = [(0,0),(-0.08,0.022),(-0.25,0.026),(-chord,0.008),(-chord,-0.004),(-0.25,0.0),(-0.08,-0.008)]
ringsL = [[bm.verts.new((x, y, z)) for (x,z) in prof] for y in (-span/2, span/2)]
for j in range(len(prof)):
    jj = (j+1) % len(prof)
    bm.faces.new((ringsL[0][j], ringsL[0][jj], ringsL[1][jj], ringsL[1][j]))
bm.faces.new(ringsL[0][::-1]); bm.faces.new(ringsL[1][:])
# endplates
for s in (-1, 1):
    y = s*span/2
    vs = [bm.verts.new(p) for p in ((0.04,y,0.07),(-chord-0.06,y,0.12),(-chord-0.06,y,-0.12),(0.04,y,-0.05))]
    vs2 = [bm.verts.new((v.co.x, v.co.y + s*0.012, v.co.z)) for v in vs]
    bm.faces.new(vs); bm.faces.new(vs2[::-1])
    for i in range(4):
        i2 = (i+1) % 4
        bm.faces.new((vs[i], vs2[i], vs2[i2], vs[i2]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me); bm.free()
me.materials.append(M['Paint'])
wing = link(bpy.data.objects.new('Wing', me)); wing.location = wingP
finish(wing, 30)
# red light strip on the trailing edge, parented so it moves with the wing
wl = box('WingLight', (0.012, span*0.92, 0.012), (0, 0, 0), 'LightRear')
wl.parent = wing; wl.location = (-chord - 0.003, 0, 0.004)
# swan-neck mounts from the rear deck up and over to the wing
for s in (-1, 1):
    y = s*0.42
    me = bpy.data.meshes.new(f'Mount{s}'); bm = bmesh.new()
    pts = [(-1.88, 0.96), (-2.02, 1.12), (-2.18, 1.27), (-2.3, 1.255)]
    th2 = 0.035
    a = [bm.verts.new((x, y - 0.012, z)) for (x,z) in pts] + [bm.verts.new((x, y - 0.012, z - th2*2.2)) for (x,z) in reversed(pts)]
    b2 = [bm.verts.new((v.co.x, y + 0.012, v.co.z)) for v in a]
    bm.faces.new(a); bm.faces.new(b2[::-1])
    for i in range(len(a)):
        i2 = (i+1) % len(a)
        bm.faces.new((a[i], b2[i], b2[i2], a[i2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free(); me.materials.append(M['Carbon'])
    finish(link(bpy.data.objects.new(f'WingMount{"L" if s>0 else "R"}', me)), 30)

# ------------------------------------------------------------ arch liners
for nm, x, s in (('LinerFL',1.45,1),('LinerFR',1.45,-1),('LinerRL',-1.45,1),('LinerRR',-1.45,-1)):
    me = bpy.data.meshes.new(nm); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=40, radius1=0.42, radius2=0.42, depth=0.5)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.1], context='VERTS')
    bm.to_mesh(me); bm.free()
    lo = link(bpy.data.objects.new(nm, me)); lo.location = (x, s*0.72, 0.335); lo.rotation_euler = (math.pi/2, 0, 0)
    lo.data.materials.append(M['Interior'])
    sd = lo.modifiers.new('Solid','SOLIDIFY'); sd.thickness = 0.012
    finish(lo, 35)

# ------------------------------------------------------------ cockpit
def rounded(name, size, loc, mat_, rot=(0,0,0), w=0.04, seg=4, sub=0):
    o = box(name, size, loc, mat_, rot)
    bv = o.modifiers.new('Bevel','BEVEL'); bv.width = w; bv.segments = seg; bv.limit_method = 'NONE'
    if sub:
        sd = o.modifiers.new('Sub','SUBSURF'); sd.levels = sub; sd.render_levels = sub
    return o
box('Tub', (2.05, 1.62, 0.04), (-0.18, 0, 0.30), 'Interior')
box('Bulkhead', (0.04, 1.62, 0.62), (-1.22, 0, 0.62), 'Interior')
box('TubL', (2.05, 0.04, 0.5), (-0.18, 0.83, 0.54), 'Interior')
box('TubR', (2.05, 0.04, 0.5), (-0.18, -0.83, 0.54), 'Interior')
# sculpted dash: one swept cowl across the cabin
me = bpy.data.meshes.new('Dash'); bm = bmesh.new()
prof = [(1.05, 0.55), (1.02, 0.80), (0.80, 0.835), (0.55, 0.83), (0.42, 0.79), (0.38, 0.70), (0.44, 0.58), (0.60, 0.52)]
ys = [-0.8 + 1.6 * k / 24 for k in range(25)]
R = []
for y in ys:
    dip = 0.035 * math.exp(-((y - 0.4) / 0.22) ** 2)   # binnacle hood in front of the driver
    R.append([bm.verts.new((x, y, z + (dip if 1 <= i <= 3 else 0))) for i, (x, z) in enumerate(prof)])
for i in range(len(R) - 1):
    for j in range(len(prof)):
        jj = (j + 1) % len(prof)
        bm.faces.new((R[i][j], R[i][jj], R[i + 1][jj], R[i + 1][j]))
bm.faces.new(R[0]); bm.faces.new(list(reversed(R[-1])))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me); bm.free(); me.materials.append(M['Interior'])
dash = link(bpy.data.objects.new('Dash', me)); finish(dash, 40)
sd = dash.modifiers.new('Sub', 'SUBSURF'); sd.levels = 2; sd.render_levels = 2
box('DashLine', (0.006, 1.5, 0.006), (0.41, 0, 0.745), 'LightRear')
# floating driver display + centre screen
rounded('Screen', (0.02, 0.5, 0.15), (0.50, 0.40, 0.90), 'Screen', rot=(0, -0.3, 0), w=0.012, seg=3)
rounded('ScreenC', (0.02, 0.34, 0.2), (0.56, 0.0, 0.82), 'Screen', rot=(0, -0.45, 0), w=0.012, seg=3)
# centre console
rounded('Console', (1.1, 0.26, 0.22), (-0.15, 0, 0.42), 'Carbon', w=0.05, seg=4)
box('ConsoleLine', (0.9, 0.004, 0.004), (-0.15, 0.13, 0.535), 'LightRear')
# bucket seats: cushion, back, bolsters, headrest
for s_, y in (('L', 0.4), ('R', -0.4)):
    rounded('Seat'+s_, (0.5, 0.46, 0.1), (-0.45, y, 0.38), 'Seat', w=0.045, seg=4)
    for b_ in (-1, 1):
        rounded('SeatBol'+s_+str(b_), (0.46, 0.08, 0.14), (-0.45, y + b_*0.21, 0.43), 'Seat', w=0.035, seg=4)
    back = rounded('SeatBack'+s_, (0.1, 0.46, 0.66), (-0.76, y, 0.70), 'Seat', rot=(0, -0.32, 0), w=0.045, seg=4)
    for b_ in (-1, 1):
        rounded('SeatBackBol'+s_+str(b_), (0.14, 0.07, 0.5), (-0.72, y + b_*0.21, 0.66), 'Seat', rot=(0, -0.32, 0), w=0.03, seg=4)
    box('SeatStripe'+s_, (0.004, 0.035, 0.46), (-0.705, y, 0.71), 'LightRear', rot=(0, -0.32, 0))
# yoke: a swept tube along a rounded outline, with grips and a hub
def tube(name, pts, r, mat_):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for k, p in enumerate(pts): sp.points[k].co = (*p, 1)
    cu.bevel_depth = r; cu.bevel_resolution = 4; cu.use_fill_caps = True
    ob = bpy.data.objects.new(name + '_c', cu); sc.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob, do_unlink=True)
    me.materials.clear(); me.materials.append(M[mat_])
    o = link(bpy.data.objects.new(name, me)); finish(o, 50)
    return o
def arc(cx, cz, rr, a0, a1, n=8):
    return [(cx + rr * math.cos(a0 + (a1 - a0) * k / n), cz + rr * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]
outline = [(-0.17, -0.07)] + arc(-0.125, 0.035, 0.045, math.pi, math.pi / 2) + arc(0.125, 0.035, 0.045, math.pi / 2, 0) + [(0.17, -0.07)]
yk_parts = []
yk_parts.append(tube('YokeRim', [(0, a, b) for (a, b) in outline], 0.016, 'Carbon'))
yk_parts.append(tube('YokeGripL', [(0, -0.17, -0.07), (0, -0.17, 0.02)], 0.022, 'Seat'))
yk_parts.append(tube('YokeGripR', [(0, 0.17, -0.07), (0, 0.17, 0.02)], 0.022, 'Seat'))
yk_parts.append(tube('YokeSpokes', [(0, -0.15, 0.0), (0, 0, -0.02), (0, 0.15, 0.0)], 0.012, 'Carbon'))
hub = cyl('YokeHub', 0.055, 0.04, (0, 0, -0.02), rot=(0, math.pi / 2, 0), mat_='Carbon', seg=24)
yk_parts.append(hub)
yoke = bpy.data.objects.new('Yoke', None); sc.collection.objects.link(yoke)
yoke.location = (0.28, 0.4, 0.75); yoke.rotation_euler = (0, -0.38, 0)
for o in yk_parts:
    o.parent = yoke
cyl('Column', 0.03, 0.26, (0.42, 0.4, 0.70), rot=(0, 1.19, 0), mat_='Carbon', seg=16)

# ------------------------------------------------------------ wheels
def make_wheel(name, loc, flip):
    bm = bmesh.new()
    R, W = 0.36, 0.27
    prof = [(0.27,-W/2),(0.335,-W/2),(0.355,-W/2+0.03),(R,-W/2+0.07),(R,W/2-0.07),(0.355,W/2-0.03),(0.335,W/2),(0.29,W/2)]
    seg = 64
    rings = [[bm.verts.new((r*math.cos(2*math.pi*k/seg), y, r*math.sin(2*math.pi*k/seg))) for (r,y) in prof] for k in range(seg)]
    for k in range(seg):
        A, B = rings[k], rings[(k+1)%seg]
        for j in range(len(prof)-1):
            f = bm.faces.new((A[j],A[j+1],B[j+1],B[j])); f.material_index = 0
    # inner tire wall closes the donut so nothing looks hollow
    inner = [rings[k][0] for k in range(seg)]
    c0 = bm.verts.new((0, -W/2+0.01, 0))
    for k in range(seg):
        f = bm.faces.new((c0, inner[(k+1)%seg], inner[k])); f.material_index = 1
    c = bm.verts.new((0, W/2-0.005, 0))
    ring = [bm.verts.new((0.29*math.cos(2*math.pi*k/seg), W/2-0.035, 0.29*math.sin(2*math.pi*k/seg))) for k in range(seg)]
    outer = [rings[k][-1] for k in range(seg)]
    for k in range(seg):
        f = bm.faces.new((c, ring[k], ring[(k+1)%seg])); f.material_index = 1
        f = bm.faces.new((ring[k], outer[k], outer[(k+1)%seg], ring[(k+1)%seg])); f.material_index = 1
    # six straight dark spokes like the reference
    for s in range(6):
        base = 2*math.pi*s/6
        pts = []
        for (r, wdt) in ((0.07, 0.03), (0.285, 0.05)):
            for side in (-1, 1):
                aa = base + side*wdt/r
                pts.append((r*math.cos(aa), r*math.sin(aa)))
        quad = [pts[0], pts[2], pts[3], pts[1]]
        top = W/2 + 0.012
        vt = [bm.verts.new((x, top, z)) for (x,z) in quad]
        vb = [bm.verts.new((x, W/2-0.03, z)) for (x,z) in quad]
        f = bm.faces.new(vt); f.material_index = 2
        f = bm.faces.new(vb[::-1]); f.material_index = 2
        for i in range(4):
            j = (i+1) % 4
            ff = bm.faces.new((vt[i], vb[i], vb[j], vt[j])); ff.material_index = 2
    hub = [bm.verts.new((0.06*math.cos(2*math.pi*k/24), W/2+0.016, 0.06*math.sin(2*math.pi*k/24))) for k in range(24)]
    f = bm.faces.new(hub); f.material_index = 2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for mn in ('Tire','Rim','Spoke'): me.materials.append(M[mn])
    ob = link(bpy.data.objects.new(name, me))
    ob.location = loc
    if flip: ob.rotation_euler = (0, 0, math.pi)
    return finish(ob, 30)
for nm, x, y in (('Wheel_FL',1.45,0.85),('Wheel_FR',1.45,-0.85),('Wheel_RL',-1.45,0.85),('Wheel_RR',-1.45,-0.85)):
    make_wheel(nm, (x, y, 0.36), y < 0)
print('built', len(sc.objects))

# ------------------------------------------------------------ export: bake modifiers into clean, outward-facing meshes
import io, contextlib, os
dg = bpy.context.evaluated_depsgraph_get()
col = bpy.data.collections.new('Export'); sc.collection.children.link(col)
srcs = [o for o in sc.objects if o.type == 'MESH' and not o.name.startswith('Cut')]
made = {}
for o in srcs:
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=False, depsgraph=dg)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_area() < 1e-9], context='FACES')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(25))
    name = o.name
    o.name = name + '_src'
    n = bpy.data.objects.new(name, me); col.objects.link(n)
    made[name] = (n, o)
for name, (n, o) in made.items():
    if o.parent and o.parent.name.endswith('_src') and o.parent.name[:-4] in made:
        n.parent = made[o.parent.name[:-4]][0]
        n.matrix_local = o.matrix_local.copy()
    else:
        n.matrix_world = o.matrix_world.copy()
    o.hide_set(True); o.hide_render = True
for o in sc.objects:
    if o.name.startswith('Cut'): o.hide_set(True)
for o in bpy.context.view_layer.objects: o.select_set(False)
for n, _ in made.values(): n.select_set(True)
bpy.context.view_layer.objects.active = made['Body'][0]
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_DIR, 'car.glb'), export_format='GLB', use_selection=True, use_active_scene=True, export_apply=True, export_yup=True, export_animations=False, export_skins=False, export_morph=False, export_texcoords=False)
print('exported', os.path.getsize(os.path.join(OUT_DIR, 'car.glb')), len(made), 'greenhouse faces', len(made['Greenhouse'][0].data.polygons), 'body faces', len(made['Body'][0].data.polygons))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, 'redshift_car.blend'), copy=True)
