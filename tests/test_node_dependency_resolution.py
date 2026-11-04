import json
import unittest
from unittest.mock import patch

from core.node_dependency_resolution import resolve_dependencies


class ResolutionTests(unittest.TestCase):
    def test_transitive_pins_marker_and_backtracking(self):
        packages={('root','1.0'):['a>=1','b==1','ignored; python_version<"2"'],('a','2.0'):['b==2'],('a','1.0'):['b==1'],('b','1.0'):[]}
        def inspect(name,version,**kwargs):
            return {'package':{'name':name,'version':version,'bytes':100,'sha256':'a'*64},'requiresDist':packages[name,version]}
        def fetch(url,*args):
            return json.dumps({'releases':{'1.0':[{'packagetype':'bdist_wheel'}],'2.0':[{'packagetype':'bdist_wheel'}]}}).encode(),1,''
        with patch('core.node_dependency_resolution.inspect_package',side_effect=inspect),patch('core.node_dependency_resolution._fetch',side_effect=fetch):
            result=resolve_dependencies([{'name':'root','version':'1.0'}])
        self.assertEqual(result['dependencies'],[{'name':'a','version':'1.0'},{'name':'b','version':'1.0'},{'name':'root','version':'1.0'}])
        self.assertIn('未下载',result['scope'])

    def test_conflicting_roots_and_external_dependency_rejected(self):
        def inspect(name,version,**kwargs):
            return {'package':{'name':name,'version':version,'bytes':100},'requiresDist':['b==2'] if name=='a' else []}
        with patch('core.node_dependency_resolution.inspect_package',side_effect=inspect),self.assertRaisesRegex(ValueError,'无法找到'):
            resolve_dependencies([{'name':'a','version':'1'},{'name':'b','version':'1'}])
        with patch('core.node_dependency_resolution.inspect_package',return_value={'package':{'name':'a','version':'1','bytes':1},'requiresDist':['b @ https://example.test/b.whl']}),self.assertRaisesRegex(ValueError,'URL依赖'):
            resolve_dependencies([{'name':'a','version':'1'}])


if __name__=='__main__':unittest.main()
