"""MusicXML / compressed MusicXML to ABC. Preserves voices, rests, chords and ties.
Unsupported rhythmic structures are rejected for manual correction.
"""
import sys, zipfile, xml.etree.ElementTree as ET
from fractions import Fraction

def convert(filename):
    if zipfile.is_zipfile(filename):
        with zipfile.ZipFile(filename) as z:
            if sum(i.file_size for i in z.infolist()) > 50_000_000:
                raise ValueError('MusicXML archive too large')
            container=ET.fromstring(z.read('META-INF/container.xml'))
            entry=next(e.attrib['full-path'] for e in container.iter() if e.tag.endswith('rootfile'))
            root=ET.fromstring(z.read(entry))
    else: root=ET.parse(filename).getroot()
    for e in root.iter(): e.tag=e.tag.split('}')[-1]
    if root.tag!='score-partwise': raise ValueError('Only partwise MusicXML supported')
    voices={};meter='4/4';known_meter=None;title=root.findtext('work/work-title') or 'Imported score'
    names={p.attrib['id']:p.findtext('part-name') or 'Part' for p in root.findall('part-list/score-part')}
    for part in root.findall('part'):
        divisions=1;clefs={};history=[]
        for measure in part.findall('measure'):
            attr=measure.find('attributes')
            if attr is not None:
                divisions=int(attr.findtext('divisions') or divisions)
                time=attr.find('time')
                if time is not None:
                    new_meter=f"{time.findtext('beats')}/{time.findtext('beat-type')}"
                    if known_meter is not None and new_meter!=known_meter: raise ValueError('박자가 바뀌는 악보는 ABC 직접 수정이 필요합니다.')
                    meter=new_meter;known_meter=new_meter
                if attr.find('transpose') is not None: raise ValueError('이조 악기는 ABC 직접 입력이 필요합니다.')
                for c in attr.findall('clef'): clefs[c.attrib.get('number','1')]='bass' if c.findtext('sign')=='F' else 'treble'
            if measure.find('barline/ending') is not None: raise ValueError('복잡한 반복 엔딩은 ABC 직접 입력이 필요합니다.')
            events={};pos=Fraction(0);last={};maxpos=Fraction(0)
            for node in measure:
                if node.tag in ('backup','forward'):
                    delta=Fraction(int(node.findtext('duration') or 0),divisions)
                    pos+=delta if node.tag=='forward' else -delta
                if node.tag!='note': continue
                if node.find('grace') is not None: raise ValueError('장식음이 있는 악보는 ABC 직접 입력이 필요합니다.')
                if node.find('unpitched') is not None: raise ValueError('타악기 악보는 지원하지 않습니다.')
                dur=Fraction(int(node.findtext('duration') or 0),divisions)
                if not dur: continue
                v=node.findtext('voice') or '1';staff=node.findtext('staff') or '1';key=(part.attrib['id'],v)
                if key not in voices: voices[key]={'clef':clefs.get(staff,'treble'),'name':names.get(part.attrib['id'],'Part'),'bars':list(history)}
                pitch=node.find('pitch')
                if pitch is None: note='z'
                else:
                    step=pitch.findtext('step');octave=int(pitch.findtext('octave'));alter=int(pitch.findtext('alter') or 0)
                    note={-2:'__',-1:'_',0:'=',1:'^',2:'^^'}[alter]+(step.lower() if octave>=5 else step)
                    note+= "'"*max(0,octave-5)+','*max(0,4-octave)
                tied=any(t.attrib.get('type')=='start' for t in node.findall('tie'))
                if node.find('chord') is not None:
                    if key not in last: raise ValueError('Invalid chord')
                    ev=last[key]
                    if ev[3]!=tied or ev[2]!=dur: raise ValueError('부분 붙임줄 또는 음가가 다른 화음은 ABC 직접 수정이 필요합니다.')
                    ev[1].append(note)
                else:
                    ev=[pos,[note],dur,tied];events.setdefault(key,[]).append(ev);last[key]=ev;pos+=dur;maxpos=max(maxpos,pos)
            if not maxpos: maxpos=Fraction(meter.split('/')[0])*4/int(meter.split('/')[1])
            def duration(d):
                return '' if d==1 else str(d.numerator) if d.denominator==1 else f'{d.numerator}/{d.denominator}'
            for key,voice in voices.items():
                if key[0]!=part.attrib['id']:continue
                tokens=[];cursor=Fraction(0)
                for start,notes,dur,tied in events.get(key,[]):
                    if start>cursor:tokens.append('z'+duration(start-cursor))
                    token=notes[0] if len(notes)==1 else '['+''.join(notes)+']'
                    tokens.append(token+duration(dur)+('-' if tied else ''));cursor=start+dur
                if cursor<maxpos:tokens.append('z'+duration(maxpos-cursor))
                bar=' '.join(tokens)
                if measure.find("barline/repeat[@direction='forward']") is not None:bar='|: '+bar
                if measure.find("barline/repeat[@direction='backward']") is not None:bar+=' :|'
                else:bar+=' |'
                voice['bars'].append(bar)
            history.append('z'+duration(maxpos)+' |')
    if not voices:raise ValueError('No notes found')
    out=['X:1','T:'+title.replace('\n',' '),'M:'+meter,'L:1/4','Q:1/4=100','K:C']
    for i,voice in enumerate(voices.values(),1):
        name=voice['name'].replace('"','').replace('\n',' ')
        out.append(f'V:{i} clef={voice["clef"]} name="{name}"')
        bars=voice['bars']
        for n in range(0,len(bars),4):out.append(' '.join(bars[n:n+4]))
    return '\n'.join(out)+'\n'

if __name__=='__main__':
    try: print(convert(sys.argv[1]))
    except Exception as e: print(str(e),file=sys.stderr);sys.exit(1)
