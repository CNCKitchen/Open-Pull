import bpy
D = bpy.data

for clip in D.movieclips:
    for track in clip.tracking.tracks:
        fn = 'C:/OpenPull/tr_{0}_{1}.csv'.format(clip.name.split('.')[0], track.name)
        with open(fn, 'w') as f:
            frameno = 0
            while True:
                markerAtFrame = track.markers.find_frame(frameno)
                if not markerAtFrame:
                    break
                frameno += 1
                coords = markerAtFrame.co.xy
                f.write('{0} {1}\n'.format(coords[0], coords[1]))