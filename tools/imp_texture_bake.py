"""Portable PBR baking for the imp. Runs inside Blender, no external packages."""
import bpy
import math
import numpy as np


def bake_pbr_atlas(character, directory, keep_materials=(), resolution=2048):
    directory.mkdir(parents=True,exist_ok=True)
    scene=bpy.context.scene
    scene.render.engine='CYCLES'; scene.cycles.samples=8
    scene.render.bake.margin=12
    scene.render.bake.use_pass_direct=False
    scene.render.bake.use_pass_indirect=False
    scene.render.bake.use_pass_color=True
    bpy.ops.object.select_all(action='DESELECT')
    character.select_set(True); bpy.context.view_layer.objects.active=character
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    originals=list(character.data.materials)
    targets={}
    for mat in originals:
        mat.use_fake_user=True
        nodes=mat.node_tree.nodes
        target=nodes.new('ShaderNodeTexImage'); target.name='Atlas bake target'
        targets[mat]=target

    def bake(name,kind,noncolor=False):
        image=bpy.data.images.new(name,width=resolution,height=resolution,alpha=False)
        if noncolor: image.colorspace_settings.name='Non-Color'
        for mat,target in targets.items():
            target.image=image
            for n in mat.node_tree.nodes: n.select=False
            target.select=True; mat.node_tree.nodes.active=target
        print('BAKING',name,flush=True)
        bpy.ops.object.bake(type=kind)
        image.filepath_raw=str(directory/(name+'.png')); image.file_format='PNG'
        image.save(); image.pack()
        return image

    albedo=bake('imp-basecolor','DIFFUSE')
    normal=bake('imp-normal','NORMAL',True)
    ao=bake('imp-occlusion','AO',True)
    # A restrained crevice tint retains the reference's painted contact shadows.
    # The separate AO source is also kept packed for further editing in Blender.
    pixels=np.empty(resolution*resolution*4,dtype=np.float32)
    occlusion=np.empty_like(pixels)
    albedo.pixels.foreach_get(pixels); ao.pixels.foreach_get(occlusion)
    rgba=pixels.reshape((-1,4)); occ=occlusion.reshape((-1,4))
    rgba[:,:3]*=.68+.32*occ[:,:3]
    albedo.pixels.foreach_set(pixels); albedo.update(); albedo.save(); albedo.pack()
    # Pack roughness into G and metallic into B through an emission bake.
    # R is neutral occlusion; no scene lighting is baked into the asset's color.
    temporary=[]
    for mat in originals:
        nodes=mat.node_tree.nodes; links=mat.node_tree.links
        p=nodes.get('Principled BSDF'); output=nodes.get('Material Output')
        combine=nodes.new('ShaderNodeCombineColor'); combine.mode='RGB'
        combine.inputs[0].default_value=1
        for slot,label in ((1,'Roughness'),(2,'Metallic')):
            socket=p.inputs[label]
            if socket.is_linked: links.new(socket.links[0].from_socket,combine.inputs[slot])
            else: combine.inputs[slot].default_value=socket.default_value
        emission=nodes.new('ShaderNodeEmission')
        links.new(combine.outputs[0],emission.inputs[0]); links.new(emission.outputs[0],output.inputs['Surface'])
        temporary.append((mat,combine,emission,p,output))
    orm=bake('imp-roughness-metallic','EMIT',True)
    for mat,combine,emission,p,output in temporary:
        mat.node_tree.links.new(p.outputs['BSDF'],output.inputs['Surface'])
        mat.node_tree.nodes.remove(combine); mat.node_tree.nodes.remove(emission)
        mat.node_tree.nodes.remove(targets[mat])

    atlas=bpy.data.materials.new('Imp | baked 2K PBR')
    atlas.use_nodes=True; nodes=atlas.node_tree.nodes; links=atlas.node_tree.links
    p=nodes.get('Principled BSDF')
    tex=nodes.new('ShaderNodeTexImage'); tex.image=albedo; tex.label='2K skin, leather, wood and metal color'
    links.new(tex.outputs['Color'],p.inputs['Base Color'])
    tex=nodes.new('ShaderNodeTexImage'); tex.image=normal
    normal_node=nodes.new('ShaderNodeNormalMap')
    links.new(tex.outputs['Color'],normal_node.inputs['Color']); links.new(normal_node.outputs['Normal'],p.inputs['Normal'])
    tex=nodes.new('ShaderNodeTexImage'); tex.image=orm
    split=nodes.new('ShaderNodeSeparateColor'); split.mode='RGB'
    links.new(tex.outputs['Color'],split.inputs[0]); links.new(split.outputs[1],p.inputs['Roughness']); links.new(split.outputs[2],p.inputs['Metallic'])
    keep=list(keep_materials)
    indices=[1+keep.index(originals[p.material_index]) if originals[p.material_index] in keep else 0 for p in character.data.polygons]
    character.data.materials.clear(); character.data.materials.append(atlas)
    for mat in keep: character.data.materials.append(mat)
    for p,index in zip(character.data.polygons,indices): p.material_index=index
    print('PBR_ATLAS_COMPLETE',resolution,'pixels; 3 embedded maps',flush=True)
