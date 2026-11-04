"""Rebuild the small, original GLB robot used by the documentation and offline tests."""
import json
import math
import struct
from pathlib import Path


def create_demo():
    chunks = bytearray()
    views, accessors = [], []
    def accessor(values, kind, components, minimum=None, maximum=None):
        offset = len(chunks)
        chunks.extend(struct.pack('<' + ('H' if components == 5123 else 'f') * len(values), *values))
        length = len(chunks) - offset
        chunks.extend(b'\0' * ((-len(chunks)) % 4))
        views.append(dict(buffer=0, byteOffset=offset, byteLength=length))
        item = dict(bufferView=len(views)-1, componentType=components, count=len(values)//{'SCALAR':1,'VEC3':3,'VEC4':4}[kind], type=kind)
        if minimum is not None: item['min'] = minimum
        if maximum is not None: item['max'] = maximum
        accessors.append(item)
        return len(accessors)-1
    positions, normals, indices = [], [], []
    faces = [((0,0,1),[(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]),((0,0,-1),[(1,-1,-1),(-1,-1,-1),(-1,1,-1),(1,1,-1)]),
             ((1,0,0),[(1,-1,1),(1,-1,-1),(1,1,-1),(1,1,1)]),((-1,0,0),[(-1,-1,-1),(-1,-1,1),(-1,1,1),(-1,1,-1)]),
             ((0,1,0),[(-1,1,1),(1,1,1),(1,1,-1),(-1,1,-1)]),((0,-1,0),[(-1,-1,-1),(1,-1,-1),(1,-1,1),(-1,-1,1)])]
    for normal, vertices in faces:
        base=len(positions)//3
        positions.extend(v/2 for vertex in vertices for v in vertex)
        normals.extend(list(normal)*4)
        indices.extend(base+i for i in (0,1,2,0,2,3))
    p=accessor(positions,'VEC3',5126,[-.5]*3,[.5]*3)
    n=accessor(normals,'VEC3',5126)
    i=accessor(indices,'SCALAR',5123)
    times=accessor([0,1,2],'SCALAR',5126,[0],[2])
    bob=accessor([0,0,0,0,.12,0,0,0,0],'VEC3',5126)
    rotations=accessor([0,0,0,1,0,1,0,0,0,0,0,-1],'VEC4',5126)
    parts=[('Body',[0,1.1,0],[.65,.85,.4],0),('Head',[0,1.8,0],[.58,.5,.5],1),('Arm L',[-.5,1.1,0],[.22,.85,.25],0),
           ('Arm R',[.5,1.1,0],[.22,.85,.25],0),('Leg L',[-.2,.35,0],[.25,.7,.3],1),('Leg R',[.2,.35,0],[.25,.7,.3],1)]
    document=dict(asset=dict(version='2.0',generator='Art Canvas original demo'),scene=0,scenes=[dict(nodes=[0])],
        nodes=[dict(name='Robot',children=list(range(1,7)))]+[dict(name=name,mesh=material,translation=position,scale=scale) for name,position,scale,material in parts],
        materials=[dict(pbrMetallicRoughness=dict(baseColorFactor=[.2,.65,.65,1],metallicFactor=.25,roughnessFactor=.45)),dict(pbrMetallicRoughness=dict(baseColorFactor=[.95,.65,.25,1],metallicFactor=.1,roughnessFactor=.6))],
        meshes=[dict(primitives=[dict(attributes=dict(POSITION=p,NORMAL=n),indices=i,material=m)]) for m in range(2)],
        animations=[dict(name='Idle',samplers=[dict(input=times,output=bob)],channels=[dict(sampler=0,target=dict(node=0,path='translation'))]),dict(name='Turn',samplers=[dict(input=times,output=rotations)],channels=[dict(sampler=0,target=dict(node=0,path='rotation'))])],
        buffers=[dict(byteLength=len(chunks))],bufferViews=views,accessors=accessors)
    raw=json.dumps(document,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4)
    return struct.pack('<4sII',b'glTF',2,12+8+len(raw)+8+len(chunks))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(chunks),0x004e4942)+chunks


if __name__=='__main__':
    target=Path(__file__).resolve().parents[2]/'docs/examples/model3d/robot.glb'
    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(create_demo())
    print(target)
