import numpy as np
from PIL import Image

def compare(basename, sz, pts):

    orig = Image.open(basename + '.png').convert('RGB')
    svg  = Image.open(basename + '-svg.png').convert('RGB')

    orig = np.array(orig)
    svg = np.array(svg)

    for i, pt in enumerate(pts):

        w, h = sz
        x, y = pt

        yslc = slice(y, y+h)
        xslc = slice(x, x+w)

        orect = orig[yslc, xslc]
        srect = svg[yslc, xslc]

        output = np.zeros((h, 2*w, 3), dtype=np.uint8)

        output[0:h, 0:w] = orect
        output[0:h, w:2*w] = srect

        output[:2] = 0
        output[-2:] = 0

        output[:, :2] = 0
        output[:, -2:] = 0

        output[:, w-1:w+1] = 0
        
        output = Image.fromarray(output, mode='RGB')


        output.save('{}-comparison{}.png'.format(basename, i+1))


    

def main():

    sz = (256, 256)
    compare('birds-head', sz, [(6686, 3233),
                               (2939, 3137),
                               (1360, 1685)])
    

if __name__ == '__main__':
    main()

    
