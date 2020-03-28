#!/usr/bin/env python

import sys
import argparse
from datetime import datetime
from collections import namedtuple
import numpy as np

import os

import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection

LSystem = namedtuple('LSystem', 'start, rules, turn_angle_deg, draw_chars')

# A few L-Systems found on pages linked above

KNOWN_LSYSTEMS = {

    'sierpinski_triangle': LSystem(
        start = 'F-G-G',
        rules = dict(F='F-G+F+G-F', G='GG'),
        turn_angle_deg = 120,
        draw_chars = None
    ),
    
    'sierpinski_arrowhead': LSystem(
        start = 'A',
        rules = dict(A='B-A-B', B='A+B+A'),
        turn_angle_deg = 60,
        draw_chars = None
    ),
    
    'dragon_curve': LSystem(
        start = 'FX',
        rules = dict(X='X+YF+', Y='-FX-Y'),
        turn_angle_deg = 90,
        draw_chars = None
    ),

    'barnsley_fern': LSystem(
        start = 'X',
        rules = dict(X='F+[[X]-X]-F[-FX]+X', F='FF'),
        turn_angle_deg = 25,
        draw_chars = None
    ),

    'sticks': LSystem(
        start = 'X',
        rules = dict(X='F[+X]F[-X]+X', F='FF'),
        turn_angle_deg = 20,
        draw_chars = 'F'
    ),

    'hilbert': LSystem(
        start = 'L',
        rules = dict(L='+RF-LFL-FR+', R='-LF+RFR+FL-'),
        turn_angle_deg = 90,
        draw_chars = 'F'
    ),

    'pentaplexity': LSystem(
        start = 'F++F++F++F++F',
        rules = dict(F='F++F++F+++++F-F++F'),
        turn_angle_deg = 36,
        draw_chars = None
    ),

    'tutorial_tree': LSystem(
        start = 'F',
        rules = dict(F='X[+F][-F]', X='XX'),
        turn_angle_deg = 45,
        draw_chars = None
    )
}

######################################################################
# make a big ol' string from an L-System starting from its start state
# using repeated string replacement.

def lsys_build_string(lsys, max_depth, axiom=None):

    if not axiom:
        axiom = lsys.start

    lstring = axiom

    rules = lsys.rules

    for i in range(max_depth):

        output = ''

        for symbol in lstring:
            if symbol in rules:
                output += rules[symbol]
            else:
                output += symbol

        lstring = output

    return lstring
    
######################################################################
# take a string and turn it into a set of line segments, returned as
# an n-by-2-by-2 array where each segment is represented as
#
#  [(x0, y0), (x1, y1)]

def lsys_segments_from_string(lsys, lstring):

    cur_pos = np.array([0., 0.])
    cur_angle_deg = 0

    cur_state = ( cur_pos, cur_angle_deg )

    # stack of pos, angle pairs
    stack = []

    segments = []
    colors = []

    for symbol in lstring:

        if symbol.isalpha():

            if lsys.draw_chars is None or symbol in lsys.draw_chars:

                cur_theta = cur_angle_deg * np.pi / 180
                offset = np.array([np.cos(cur_theta), np.sin(cur_theta)])
                new_pos = cur_pos + offset
                segments.append([cur_pos, new_pos])
                colors.append(symbol)
                cur_pos = new_pos

        elif symbol == '+':

            cur_angle_deg += lsys.turn_angle_deg

        elif symbol == '-':

            cur_angle_deg -= lsys.turn_angle_deg

        elif symbol == '[':

            stack.append( ( cur_pos, cur_angle_deg ) )

        elif symbol == ']':

            cur_pos, cur_angle_deg = stack.pop()

        else:

            raise RuntimeError('invalid symbol:' + symbol)
        
    return np.array(segments), colors

######################################################################
# parse command-line options for this program

def parse_options():

    parser = argparse.ArgumentParser(
        description='simple Python L-system renderer')

    parser.add_argument('lname', metavar='LSYSTEM', nargs=1,
                        help='name of desired L-system',
                        type=str,
                        choices=KNOWN_LSYSTEMS)

    parser.add_argument('max_depth', metavar='MAXDEPTH', nargs=1,
                        help='maximum depth to evaluate', type=int)

    parser.add_argument('-x', dest='max_segments', metavar='MAXSEGMENTS',
                        type=int, default=100000,
                        help='maximum number of segments to plot')

    parser.add_argument('-a', dest='axiom', metavar='MAXSEGMENTS',
                        help='alternative axiom')
    
    parser.add_argument('-t', dest='text_only', action='store_true',
                        help='use text output instead of PNG')

    opts = parser.parse_args()

    opts.lname = opts.lname[0]
    opts.max_depth = opts.max_depth[0]

    opts.lsys = KNOWN_LSYSTEMS[opts.lname]

    return opts

######################################################################
# main function

def main():

    opts = parse_options()

    # time segment generation
    start = datetime.now()

    lstring = lsys_build_string(opts.lsys, opts.max_depth,
                                axiom=opts.axiom)

    segments, colors = lsys_segments_from_string(opts.lsys, lstring)

    available_colors = 'brmkcgy'
    color_lookup = dict()
    fixed_colors = 'b'

    if len(segments) < 1000:

        print('got string:', lstring)

        all_exprs = [opts.lsys.start]
        all_exprs += list(opts.lsys.rules.keys())
        all_exprs += list(opts.lsys.rules.values())

        fixed_colors = []

        for c in all_exprs:
            if c not in color_lookup:
                if c in available_colors:
                    color_lookup[c] = c
                    available_colors = available_colors.replace(c, '')
                else:
                    color_lookup[c] = available_colors[0]
                    available_colors = available_colors[1:]

        for c in colors:
            fixed_colors.append(color_lookup[c])

    # print elapsed time
    elapsed = (datetime.now() - start).total_seconds()

    lc = LineCollection(segments, color=fixed_colors)

    ax = plt.axes()

    ax.add_collection(lc)
    ax.autoscale()

    
    if len(segments) < 100:
        points = np.array( list(set(tuple(seg) for seg in segments.reshape(-1, 2))) )
        plt.plot(points[:,0], points[:,1], 'k.')

    filename = '{}{}_{}.png'.format(opts.lname,
                                    '' if opts.axiom is None else '_' + opts.axiom,
                                    opts.max_depth)
    
    plt.axis('equal')
    plt.axis('off')

    plt.savefig(filename, dpi=300, facecolor=(1., 1., 1., 0.))

    os.system('mogrify -trim -bordercolor transparent -border 10x10 ' + filename)
    
    print('wrote', filename)

    

    
if __name__ == '__main__':
    main()

    

